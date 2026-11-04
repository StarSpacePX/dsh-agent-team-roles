/**
 * dsh-agent-team-roles — host half / 名册、任务板与群聊日志（§5.43–§5.45、§5.50）。
 *
 * §5.43 — 成员名册（user m10481：只有 Lead 知道全队）。注册在 **Lead 自己的 agent
 * 作用域**上，所以成员什么也拿不到：`tryMembership(agent).role !== 'lead'` 就在那里
 * 停住 —— 不需要自己做任何过滤，成员之间天然看不见彼此。
 *
 * §5.44 挂在同一个作用域、同一个窗口：任务板监听器是 Lead 上的 `session/event`
 * 监听器，因为 Team 事件是发布给「从追加该事件的 Session 自己的上下文里收集到的
 * 观察者」的。骨架是部署自带的那份，装进每一个还活着的 agent，再跟随
 * `agent/created` / `agent/disposed`。两个服务必须一起注入 —— 没有 Agent Teams
 * 运行时的 profile 会让这一块保持 pending，其余功能照常。
 *
 * §5.45 与 §5.50 是两个「宿主半的唯一入口」：`/command` 与 `/team-log` 的处理函数
 * 够不着注入作用域里的 `agents`，于是注入时把闭包泊进 `h.teamSend` / `h.teamLogReader`。
 *
 * @module dsh-agent-team-roles/host/roster
 */
import { SKELETON_READ_ERROR, installRoster, installTeammateStyle, isLead, isTeammate } from '../team-roster.js'
import { applyTeamEvents, createTeamLog, serializeTeamLog } from '../team-log.js'
import { installWatcher } from '../team-watch.js'
import { createArbiterWorkspace, workspaceDirOf } from './arbiter-workspace.js'

/**
 * @param {object} h - the shared host state ({@link ./context.js}).
 */
export function installTeamRoster(h) {
  h.ctx.inject(['agents', 'agentTeams'], (scoped) => {
    const teams = scoped.agentTeams
    const agents = scoped.agents
    if (teams === undefined || teams === null || typeof teams.tryMembership !== 'function') return
    if (agents === undefined || agents === null || typeof agents.list !== 'function') return

    // §5.45 — the dispatch half of R5. The client has already consumed the
    // draft (`@名字 正文`), so all that is left is handing the body to the
    // member. `queued` is a normal answer, not an error: the member may be
    // busy and the runtime will deliver at its next step boundary.
    scoped.effect(
      () => {
        h.teamSend = async ({ sessionId, target, body }) => {
          if (typeof teams.sendMessage !== 'function') throw new Error('这个部署的 Agent Teams 没有 sendMessage')
          const lead = typeof agents.get === 'function' ? agents.get(sessionId) : undefined
          if (lead === undefined || lead === null) throw new Error('这个会话不在线，没法把消息交给成员')
          // The runtime's own refusals stay English and terse (`teammate "x" is
          // not an active member`, `TEAM_MAILBOX_FULL`, …). The member name is
          // the part the operator cannot reconstruct from the message, so it
          // goes in front and the runtime's reason is kept verbatim.
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

    // §5.50 — the read half of 「群聊历史」. The 群聊 tab used to see only the
    // browser's own tail of the Session log (≈1000 entries); a team that worked
    // earlier in a long session fell outside it and the tab claimed there was no
    // conversation. The Lead's log is the authority and the host already has all
    // of it, so the projection is folded here and served on demand — no Postgres,
    // no client-side paging, and nothing that only exists in the browser.
    //
    // The cache is per Session and folds only the tail: `scanned` is how many
    // events have already been applied, so a poll costs one slice of the new
    // events instead of a full rescan.
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

          // The log can get shorter under us (a fresh fork, a folded replay); a
          // cursor past the end means the cache no longer describes this
          // Session, so start over rather than silently lose history.
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
      // §5.65 — 骨架是 md 资产（`templates\通信骨架.md`）：读不到只记一条 warning，
      // 装配照常（少一段形状，不是让 Lead 的 turn 炸掉）。
      if (SKELETON_READ_ERROR !== null) h.logger.warn(String(SKELETON_READ_ERROR))

      /** @type {Map<object, (() => void)[]>} */
      const installed = new Map()

      /**
       * 这条会话落在**监察员工作区**里时，名册归副本插件 `dsh-arbiter-roles` 管，
       * 这里一个字都不装——否则同一条会话会被塞两套成员（用户 m02696 / m03336）。
       *
       * 判据是**会话 cwd 比对工作区目录**（不看 preset）：工作区目录从 cordis 服务
       * `arbiterWorkspace` 同步读（dsh-arbiter `ctx.provide` 的那个，就是它保存的
       * `workspacePath`）；服务缺席时仍排除它的默认工作区
       * `<homedir>\Desktop\dsh-arbiter` 兜底，保证两边永远不撞。
       * 判断不了（没有 cwd）时照旧装，行为与改造前一致。
       */
      const workspace = createArbiterWorkspace({ dirOf: () => workspaceDirOf(h.ctx) })

      const maybeInstall = (agent) => {
        if (agent === undefined || agent === null || installed.has(agent)) return
        if (workspace.isArbiterSession(agent)) return
        if (!isLead(teams, agent)) {
          // §5.64/§5.65 — 成员侧只挂那份回报骨架。
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
            // §5.46 — the roles ride in the same contribution: the Lead must know
            // the exact `spawn_teammate` name each role answers to. A getter, so a
            // role added or renamed mid-session appears without re-installing.
            { roles: () => h.store.roles, prefix: h.options.prefix },
          )
          if (typeof dispose === 'function') disposers.push(dispose)
          const stopWatching = installWatcher(
            agent,
            teams,
            (error) => h.logger.warn(`任务板监听失败：${String((error && error.message) || error)}`),
            // 成员的「空闲」不是团队事件，只能在 agent 事件那一路上看（§5.44）。
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
          // §5.50 — a disposed Session cannot answer `/team-log` any more, so its
          // cached projection goes with it.
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
