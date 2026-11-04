/**
 * §5.44 — event-driven dispatch (R4).
 *
 * The user's rule (m10481): 「R4 事件运行时必须搞定，不能只顾派发」. The Team
 * runtime only ships one half of that: every mutation is durable and visible
 * (`…\dsh-experimental-agent-team\lib\types\journal.js:53-61` appends
 * `team/task` to the Lead Session log), but **nothing in the deployment ever
 * reacts to it**. The one call site of `sendMessage` is the `send_message` tool
 * itself (`…\dsh-experimental-tool-agent-team\lib\index.js:312`), and the tool's
 * own policy says so out loud: `Task readiness never starts an owner`
 * (`…\lib\index.js:27`).
 *
 * Two of those gaps are answerable without guessing what the user meant, which
 * is why this module only reports them:
 *
 * 1. a task that is `pending`, `ready` and unowned — a blocker finished, so
 *    something became startable and no one is looking;
 * 2. a task that is `in_progress` under an owner who is no longer on the
 *    roster — the work is stranded.
 *
 * Both are facts read back from `listTasks()`, never inferred from
 * `team/task`'s payload (`{version, teamId, task}` carries no `ready` and no
 * action).
 *
 * Wake-up is `agent.followup()` — inbox target `next-turn` with `wakeup: true`
 * (`…\dsh-agent-loop\lib\index.js:806-811`), so an idle Lead opens a turn and a
 * busy Lead sees it at its next turn boundary. That path has **no budget of its
 * own** (`wakeDriver()` :854-875 always starts a driver when idle), so the
 * budget lives here: one notice per task revision, and a hard per-session cap.
 *
 * The message is a mechanism-owned user message whose `source.kind` is a
 * producer-owned string (`agent-team-roles`) — the same shape the deployment's
 * own runtime-context snapshot uses (`…\dsh-agent-loop\lib\index.js:218`) —
 * rather than a Team mailbox message, because attributing our notice to a
 * teammate would be a lie and would wake a member as collateral.
 *
 * `{kind: 'plugin'}` is **retired syntax and bricks the Lead Session**:
 * `…\dsh-session-format-v3-to-v4\lib\index.js:126-128` refuses to persist any
 * message whose source kind is empty or `"plugin"`, and once that append fails
 * every later append — the user's own message included — fails with
 * `format v4 message requires a producer-owned source kind`.
 *
 * @module dsh-agent-team-roles/team-watch
 */

import { randomUUID } from 'node:crypto'

/** Hard cap on notices per Lead session: a self-woken turn is not free. */
export const NOTICE_MAX_PER_SESSION = 8

/** Dedup keys kept per session before the oldest are forgotten. */
const REMEMBERED = 200

/** The `source.kind` every notice carries: producer-owned, never the retired `'plugin'`. */
export const NOTICE_SOURCE = { kind: 'agent-team-roles', plugin: '@deepseek-ai/dsh-agent-team-roles' }

/** `id「subject」`, with the subject only when there is one to show. */
function taskLabel(task) {
  const subject = typeof task.subject === 'string' ? task.subject.trim() : ''
  return subject.length > 0 ? `${task.id}「${subject}」` : task.id
}

/** Tasks that became startable and still have nobody on them. */
function readyUnclaimed(tasks) {
  if (!Array.isArray(tasks)) return []
  return tasks.filter(
    (task) =>
      task !== null &&
      typeof task === 'object' &&
      task.status === 'pending' &&
      task.ready === true &&
      (task.ownerName === undefined || task.ownerName === null || task.ownerName === ''),
  )
}

/** Tasks whose owner is not on the roster any more. */
function strandedTasks(tasks, names) {
  if (!Array.isArray(tasks)) return []
  return tasks.filter(
    (task) =>
      task !== null &&
      typeof task === 'object' &&
      task.status === 'in_progress' &&
      typeof task.ownerName === 'string' &&
      task.ownerName.length > 0 &&
      !names.has(task.ownerName),
  )
}

/**
 * Teammates that are not running **while** some ready work has no owner.
 *
 * 「成员空闲」 is not a durable Team event — the runtime computes member
 * availability at read time (`availability()`: `agent.status === 'running' ?
 * 'running' : 'inactive'`, `…\dsh-experimental-agent-team\lib\index.js:727-730`)
 * and only journals `team/member` for creation and provisioning settlement. The
 * observable transition is the agent lane: `ctx.on('agent/status', …)`
 * (`…\dsh-agent-loop\lib\index.js:790-799`), which the deployment's own
 * goal-round driver already uses to act when a turn ends
 * (`…\dsh-goal-round-driver\lib\index.js:217-222`).
 *
 * A member is idle most of the time, so 「idle」 alone is never worth a turn.
 * It only becomes actionable when there is ready, unowned work to hand over —
 * that pairing is the fact this returns.
 */
export function idleMembers(members, tasks) {
  if (!Array.isArray(members)) return []
  if (readyUnclaimed(tasks).length === 0) return []
  return members.filter(
    (row) =>
      row !== null &&
      typeof row === 'object' &&
      row.role !== 'lead' &&
      row.status === 'inactive' &&
      typeof row.name === 'string' &&
      row.name.length > 0,
  )
}

/**
 * The notice for one pass, or null when there is nothing worth a turn.
 *
 * @param {{ ready?: object[], stranded?: object[], idle?: object[] }} findings
 * @returns {{ key: string, text: string } | null}
 */
function noticeFor(findings) {
  const ready = findings.ready ?? []
  const stranded = findings.stranded ?? []
  const idle = findings.idle ?? []
  if (ready.length === 0 && stranded.length === 0) return null

  const lines = ['[agent-team-roles] 任务板有变化（插件自动提示，不是用户发的消息）：']
  if (ready.length > 0) {
    lines.push('下面这些任务已经可以开始，但还没有人认领：')
    for (const task of ready) lines.push(`- ${taskLabel(task)}`)
    lines.push('用 team_task_update 的 reassign 把 owner 指派给某位成员（成员名单就在团队名册里），或者直接 send_message 把活派给他。')
  }
  if (stranded.length > 0) {
    lines.push('下面这些任务的负责人已经不在团队里：')
    for (const task of stranded) lines.push(`- ${taskLabel(task)}（负责人 ${task.ownerName}）`)
    lines.push('重新指派 owner，或者先 release 回待认领。')
  }
  if (idle.length > 0) {
    lines.push('下面这些成员现在空闲（不在跑），上面那些没人认领的活可以直接派给他们：')
    for (const row of idle) lines.push(`- ${row.name}${row.model === undefined ? '' : `（${row.model}）`}`)
  }

  const key = [
    ...ready.map((task) => `ready:${task.id}:${task.revision}`),
    ...stranded.map((task) => `stranded:${task.id}:${task.revision}`),
    // The idle set is part of the identity: a member finishing its turn is
    // exactly the event that should produce a fresh notice (and the same set
    // must not produce a second one).
    ...(idle.length === 0 ? [] : [`idle:${idle.map((row) => row.name).join(',')}`]),
  ].join('|')
  return { key, text: lines.join('\n') }
}

/** Remember one key, forgetting the oldest so the set cannot grow without bound. */
function remember(keys, key) {
  keys.add(key)
  while (keys.size > REMEMBERED) {
    const oldest = keys.values().next()
    if (oldest.done === true) break
    keys.delete(oldest.value)
  }
}

/**
 * Watch one Lead Session for board changes that need the Lead's attention.
 *
 * The listener belongs on **the Lead's own agent scope**: Team events are
 * session appends published through `session/event` observers collected from
 * the appending session's own emit context
 * (`…\dsh-session\lib\types\index.js:600-605`), so a listener on the plugin's
 * root context never sees them.
 *
 * Every failure is reported and swallowed: a watcher may not break the
 * deployment's event dispatch.
 *
 * @param {any} agent - the exact live Lead agent.
 * @param {any} teams - the `agentTeams` service.
 * @param {(error: unknown) => void} [onError]
 * @param {{ maxNotices?: number, statusScope?: any }} [options] - `statusScope`
 *   is the plugin scope that hosts the `agent/status` listener (the agent lane
 *   is not the Lead Session lane, so a member finishing its turn is only
 *   visible there).
 * @returns {(() => void) | null} disposer, or null when the scope cannot host it.
 */
export function installWatcher(agent, teams, onError, options = {}) {
  const scoped = agent === null || agent === undefined ? undefined : agent.ctx
  if (scoped === undefined || scoped === null || typeof scoped.on !== 'function') return null
  if (teams === undefined || teams === null || typeof teams.listTasks !== 'function') return null

  const maxNotices =
    typeof options.maxNotices === 'number' && Number.isFinite(options.maxNotices) && options.maxNotices >= 0
      ? options.maxNotices
      : NOTICE_MAX_PER_SESSION
  const statusScope = options.statusScope
  const state = { keys: new Set(), sent: 0, busy: false }

  const observe = async (kind) => {
    if (state.busy || state.sent >= maxNotices) return
    if (kind !== 'task' && kind !== 'status') return
    state.busy = true
    try {
      // The Lead is mid-turn: it is already reading its own board, and waking
      // it would only interleave two turns.
      const members = teams.listMembers(agent)
      const lead = Array.isArray(members) ? members.find((row) => row?.role === 'lead') : undefined
      if (lead !== undefined && lead.status === 'running') return

      const names = new Set(
        (Array.isArray(members) ? members : [])
          .map((row) => (row === null || typeof row !== 'object' ? undefined : row.name))
          .filter((name) => typeof name === 'string' && name.length > 0),
      )
      const tasks = await teams.listTasks(agent)
      const notice = noticeFor({
        ready: readyUnclaimed(tasks),
        stranded: strandedTasks(tasks, names),
        idle: idleMembers(members, tasks),
      })
      if (notice === null || state.keys.has(notice.key)) return

      agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: notice.text }],
        source: NOTICE_SOURCE,
      })
      remember(state.keys, notice.key)
      state.sent += 1
    } catch (error) {
      if (typeof onError === 'function') onError(error)
    } finally {
      state.busy = false
    }
  }

  // Returning the promise is what the deployment's own dispatch expects: it
  // calls the listener and swallows a rejection
  // (`…\dsh-session\lib\types\index.js:600-605`). This one never rejects, so a
  // broken board read stays a warning instead of an unhandled rejection.
  const swallow = (work) =>
    work.then(
      () => undefined,
      (error) => {
        if (typeof onError === 'function') onError(error)
      },
    )

  const listener = (_session, event) => {
    if (event === null || typeof event !== 'object' || event.type !== 'team/task') return undefined
    return swallow(observe('task'))
  }

  const off = scoped.on('session/event', listener)

  // A teammate that just finished its turn stops being `running`. Without this
  // lane the Lead would only ever learn about idle members by asking.
  //
  // Only teammates get to wake the Lead this way: the Lead's **own** turn
  // endings would otherwise re-open the board it just closed, and a plain
  // subagent is not part of the Team (`tryMembership` answers `undefined` —
  // `…\dsh-experimental-agent-team\lib\types\index.d.ts:100-105`).
  const isTeammate = (subject) => {
    if (subject === undefined || subject === null) return false
    if (typeof teams.tryMembership !== 'function') return false
    try {
      const membership = teams.tryMembership(subject)
      return membership !== null && typeof membership === 'object' && membership.role !== 'lead'
    } catch {
      return false
    }
  }
  const offStatus =
    statusScope !== undefined && statusScope !== null && typeof statusScope.on === 'function'
      ? statusScope.on('agent/status', ({ agent: subject, status } = {}) => {
          if (status !== 'idle') return undefined
          if (!isTeammate(subject)) return undefined
          return swallow(observe('status'))
        })
      : undefined

  return () => {
    if (typeof off === 'function') off()
    if (typeof offStatus === 'function') offStatus()
    state.keys.clear()
  }
}
