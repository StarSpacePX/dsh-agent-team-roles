/**
 * 名册、任务板与群聊日志。
 *
 * 名册注册在 Lead 自己的 agent 作用域上，所以成员天然拿不到：tryMembership(agent).role 不是
 * lead 就在那里停住，不需要自己做过滤，成员之间也看不见彼此。任务板监听器挂在同一个作用域、
 * 同一个窗口，因为 Team 事件只发给从追加该事件的 Session 上下文里收集到的观察者。
 *
 * @module dsh-agent-team-roles/host/roster
 */
import { SKELETON_READ_ERROR, installRoster, installTeammateStyle, isLead, isTeammate } from '../team-roster.js'
import { applyTeamEvents, createTeamLog, serializeTeamLog } from '../team-log.js'
import { installWatcher } from '../team-watch.js'
import { createArbiterWorkspace, workspaceDirOf } from './arbiter-workspace.js'

/** @param {object} h 共享宿主状态 */
export function installTeamRoster(h) {
  h.ctx.inject(['agents', 'agentTeams'], (scoped) => {
    const teams = scoped.agentTeams
    const agents = scoped.agents
    if (teams === undefined || teams === null || typeof teams.tryMembership !== 'function') return
    if (agents === undefined || agents === null || typeof agents.list !== 'function') return

// 派发：客户端已经消费掉草稿（@名字 正文），这里只把正文交给成员。
// queued 是正常答复，不是错误：成员可能正忙，运行时会在它的下一个 step 边界投递。
    scoped.effect(
      () => {
        h.teamSend = async ({ sessionId, target, body }) => {
          if (typeof teams.sendMessage !== 'function') throw new Error('这个部署的 Agent Teams 没有 sendMessage')
          const lead = typeof agents.get === 'function' ? agents.get(sessionId) : undefined
          if (lead === undefined || lead === null) throw new Error('这个会话不在线，没法把消息交给成员')
// 运行时的拒绝原话保留：成员名是操作者无法从消息里还原的部分，所以放前面，原因逐字保留。
          try {
            return await teams.sendMessage(lead, {
              target,
              content: [{ type: 'text', text: body }],
              signal: AbortSignal.timeout(15000),
            })
          } catch (error) {
            throw new Error(`没能把消息交给「${target}」：${String((error && error.message) || error)}`)
          }
        }
        return () => {
          h.teamSend = null
        }
      },
      'agent-team-roles: team send',
    )

// 群聊历史的读半边：浏览器只看得到会话日志的尾部约 1000 条，早先的对话会落空；
// Lead 的日志才是权威，宿主这里折叠投影、按需返回。
    scoped.effect(
      () => {
        h.teamLogReader = ({ sessionId }) => {
          const lead = typeof agents.get === 'function' ? agents.get(sessionId) : undefined
          if (lead === undefined || lead === null) throw new Error('这个会话不在线，读不到它的会话日志')
          const session = lead.session
          if (session === undefined || session === null || typeof session.snapshotEvents !== 'function') {
            throw new Error('这个会话没有可读的事件日志')
          }

          let entry = h.teamLogs.get(sessionId)
          if (entry === undefined) {
            entry = { log: createTeamLog(), scanned: 0 }
            h.teamLogs.set(sessionId, entry)
          }

// 日志可能变短（fork、折叠重放）；游标越过末尾说明缓存不再描述这个会话，从头开始而不是悄悄丢历史。
          if (entry.scanned > session.seq) {
            entry.log = createTeamLog()
            entry.scanned = 0
          }
          if (entry.scanned < session.seq) {
            applyTeamEvents(entry.log, session.snapshotEvents(entry.scanned))
            entry.scanned = session.seq
          }

          return serializeTeamLog(entry.log)
        }
        return () => {
          h.teamLogReader = null
        }
      },
      'agent-team-roles: team log',
    )

    scoped.effect(() => {
// 骨架是 md 资产：读不到只记一条 warning，装配照常，不让 Lead 的 turn 炸掉。
      if (SKELETON_READ_ERROR !== null) h.logger.warn(String(SKELETON_READ_ERROR))

      const installed = new Map()

/** 会话落在监察员工作区时，名册归副本插件 dsh-arbiter-roles 管，这里一个字都不装，
 * 否则同一条会话会被塞两套成员。判据是会话 cwd 比对工作区目录（不看 preset），
 * 判断不了（没有 cwd）时照旧装。 */
      const workspace = createArbiterWorkspace({ dirOf: () => workspaceDirOf(h.ctx) })

      const maybeInstall = (agent) => {
        if (agent === undefined || agent === null || installed.has(agent)) return
        if (workspace.isArbiterSession(agent)) return
        if (!isLead(teams, agent)) {
// 成员侧只挂那份回报骨架。
          if (!isTeammate(teams, agent)) return
          try {
            const dispose = installTeammateStyle(agent)
            if (typeof dispose === 'function') installed.set(agent, [dispose])
          } catch (error) {
            h.logger.warn(`输出格式说明注册失败：${String((error && error.message) || error)}`)
          }
          return
        }
        const disposers = []
        try {
          const dispose = installRoster(
            agent,
            teams,
            (error) => h.logger.warn(`成员名册读取失败：${String((error && error.message) || error)}`),
// 角色与名册在同一份贡献里：Lead 必须知道每个角色对应的精确 spawn_teammate 名。
// 用 getter，会话中途新增或改名的角色不用重装。
            { roles: () => h.store.roles, prefix: h.options.prefix },
          )
          if (typeof dispose === 'function') disposers.push(dispose)
          const stopWatching = installWatcher(
            agent,
            teams,
            (error) => h.logger.warn(`任务板监听失败：${String((error && error.message) || error)}`),
// 成员的「空闲」不是团队事件，只能从 agent 事件里看。
            { statusScope: scoped },
          )
          if (typeof stopWatching === 'function') disposers.push(stopWatching)
          if (disposers.length > 0) installed.set(agent, disposers)
        } catch (error) {
          for (const dispose of disposers) dispose()
          h.logger.warn(`成员名册注册失败：${String((error && error.message) || error)}`)
        }
      }

// 判定是同步的（服务就在本进程里）：先装存量 agent，再跟随两个 agent 事件。
      for (const agent of agents.list()) maybeInstall(agent)
      const offs = [
        scoped.on('agent/created', ({ agent }) => maybeInstall(agent)),
        scoped.on('agent/disposed', ({ agent }) => {
          for (const dispose of installed.get(agent) ?? []) dispose()
          installed.delete(agent)
// 会话被释放后再也答不了 /team-log，它的缓存投影一起删掉。
          const sessionId = agent !== null && agent !== undefined && agent.session !== undefined ? agent.session.id : undefined
          if (typeof sessionId === 'string') h.teamLogs.delete(sessionId)
        }),
      ]

      return () => {
        for (const off of offs) if (typeof off === 'function') off()
        for (const disposers of installed.values()) for (const dispose of disposers) dispose()
        installed.clear()
      }
    }, 'agent-team-roles: roster')
  })
}
