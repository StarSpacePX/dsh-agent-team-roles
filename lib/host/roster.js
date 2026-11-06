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
import { serializeMessages } from '../team-messages.js'
import { installWatcher } from '../team-watch.js'
import { createArbiterWorkspace, workspaceDirOf } from './arbiter-workspace.js'
import { relayWrites } from './relay-record.js'
import { appendRows, leadIdOf, leadJournal, readRows } from './relay-store.js'

/** @param {object} h 共享宿主状态 */
export function installTeamRoster(h) {
  h.ctx.inject(['agents', 'agentTeams'], (scoped) => {
    const teams = scoped.agentTeams
    const agents = scoped.agents
    if (teams === undefined || teams === null || typeof teams.tryMembership !== 'function') return
    if (agents === undefined || agents === null || typeof agents.list !== 'function') return

// 群聊消息本体：一条转达消息只落在**收件人**的会话日志里，改成投递时的一条通用
// `agent/inbox/spliced`。监听只装一次，装在插件根作用域上，覆盖所有会话（和
// dsh-session-pg、dsh-arbiter 同一条路），不像早先那样逐个 agent 装。
    scoped.effect(
      () => {
        const off = scoped.on('session/event', (session, event) => {
          try {
            for (const write of relayWrites(session, event)) {
              appendRows(write.file, write.rows, (line) => h.logger.warn(line))
            }
          } catch (error) {
            h.logger.warn(`群聊消息记录失败：${String((error && error.message) || error)}`)
          }
        })
        return () => {
          if (typeof off === 'function') off()
        }
      },
      'agent-team-roles: relay messages',
    )

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

// 群聊页的读入口（两层）：
//   · 会话级：一个群聊页 = 一个会话，只读这个会话所属团队的那份账本
//   · 成员级：Lead 页看全队，成员页只看自己与 Lead 的往返
//
// 团队归属只认磁盘：拿自己的会话 id 去账本里逐行匹配，哪份账本的行里出现过这个 id，
// 那份文件的文件名就是 Lead 的 id。不走 sessions.get()——成员跑完下线，运行时里没有它。
// 名册与任务板问 Lead 的 listMembers/listTasks；消息读同一份账本，谁在不在线都不影响。
    scoped.effect(
      () => {
        h.teamLogReader = ({ sessionId }) => {
          const self = String(sessionId)
          const teamId = leadIdOf(self)
          const isLeadPage = teamId === self

// 1) 运行时：Lead 直接查。拿不到就只是少了名字和状态，读盘照常。
          const leadAgent = typeof agents.get === 'function' ? agents.get(teamId) : undefined
          const liveMembers =
            leadAgent !== undefined && leadAgent !== null && typeof teams.listMembers === 'function'
              ? teams.listMembers(leadAgent)
              : []
          const roster = Array.isArray(liveMembers) ? liveMembers : []
          const nameById = new Map([[teamId, 'lead']])
          const phaseById = new Map()
          for (const row of roster) {
            if (row === null || typeof row !== 'object' || row.id === undefined) continue
            const id = String(row.id)
            if (typeof row.name === 'string' && row.name !== '') nameById.set(id, row.name)
            if (typeof row.status === 'string') phaseById.set(id, row.status)
          }
          const tasks =
            leadAgent !== undefined && leadAgent !== null && typeof teams.listTasks === 'function'
              ? teams.listTasks(leadAgent)
              : []

// 2) 消息：一个团队一个文件；成员页只留收发方里有自己的。
          const allRows = readRows(leadJournal(teamId))
          const pageRows =
            isLeadPage === true
              ? allRows
              : allRows.filter((row) => {
                  const message = row.message
                  if (message === null || typeof message !== 'object') return false
                  return String(message.senderId) === self || String(message.targetId) === self
                })

// 3) 这一页允许出现的人：Lead 页看全队，成员页只看自己与 Lead。
          const allowed = new Set([teamId])
          if (isLeadPage === true) {
            for (const row of roster) {
              if (row !== null && typeof row === 'object' && row.id !== undefined) allowed.add(String(row.id))
            }
          } else {
            allowed.add(self)
          }

          const nameOf = (id) => {
            const key = String(id)
            const name = nameById.get(key)
            return typeof name === 'string' && name !== '' ? name : key
          }
          return {
            teamId,
// 名册只列成员，Lead 自己不上榜（它在这个页面上就叫 lead）；成员页只留「Lead + 自己」。
            members: [...nameById]
              .filter(([id]) => id !== teamId && (isLeadPage === true || id === self))
              .map(([id, name]) => ({
                id,
                name,
                role: 'teammate',
                phase: phaseById.get(id) ?? 'idle',
              })),
            tasks: Array.isArray(tasks) ? tasks : [],
            messages: serializeMessages(pageRows, { allowed, nameOf }),
          }
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
