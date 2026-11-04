/**
 * 《群聊》的历史：宿主半的**日志投影**（user m13923 第 3 条）。
 *
 * 为什么投影在宿主半：客户端只能读到会话日志的一个有界窗口。§5.48 量过 —
 * 在一个 2.89 万条的会话里，窗口只有 1041 条（seq 27883–28923），而八条 `team/*`
 * 记录躺在 seq 21801–21862，于是「团队明明工作过、tab 却说本会话没有群聊记录」。
 * 投影正是为此：「这样实用性广，开源的时候不用别人装 pg」。
 *
 * 所以投影活在宿主半：Lead 会话的事件日志就是权威来源
 * （`dsh-experimental-agent-team` 把团队事件 append 进 Lead 的会话日志，
 * 顺序与时间由 `seq`/`time` 负责），宿主半把它折叠成三张表，网页端再来取。
 * 好处是**不受客户端窗口限制、也不需要任何外部数据库**：日志里有什么就投影什么。
 *
 * 这里只有纯函数：没有推断、没有补全。日志里没有的事件不会出现在投影里；
 * 一条 `team/message/queued` 没有对应 `team/message/delivered` 就是「排队中」。
 *
 * @module dsh-agent-team-roles/team-log
 */

/** The four event types the Agent Teams runtime appends to the Lead's log. */
export const TEAM_EVENT_TYPES = Object.freeze([
  'team/member',
  'team/task',
  'team/message/queued',
  'team/message/delivered',
])

/**
 * A fresh, empty projection.
 *
 * `messages` is keyed by message id (the durable enqueue is the only place the
 * body appears; `delivered` carries only the id), `members`/`tasks` are
 * whole-value records where the latest event for an id wins.
 *
 * @returns {{
 *   teamId: string | null,
 *   lastSeq: number,
 *   members: Map<string, object>,
 *   tasks: Map<string, object>,
 *   messages: Map<string, { message: object, seq: number | null, time: number | null }>,
 *   delivered: Set<string>,
 *   applied: number,
 * }}
 */
export function createTeamLog() {
  return {
    teamId: null,
    lastSeq: -1,
    members: new Map(),
    tasks: new Map(),
    messages: new Map(),
    delivered: new Set(),
    applied: 0,
  }
}

/**
 * Fold **one** raw Session event into the projection.
 *
 * @param {object} log - a projection from {@link createTeamLog}.
 * @param {object} event - a raw `SessionEvent` (`{ type, seq, time, data }`).
 * @returns {boolean} whether the event belonged to the team.
 */
export function applyTeamEvent(log, event) {
  if (log === null || typeof log !== 'object') return false
  if (event === null || typeof event !== 'object') return false
  if (TEAM_EVENT_TYPES.includes(event.type) !== true) return false

  const data = event.data
  if (data === null || typeof data !== 'object') return false

  const seq = Number(event.seq)
  const time = Number(event.time)
  if (Number.isFinite(seq) && seq > log.lastSeq) log.lastSeq = seq
  if (typeof data.teamId === 'string' && data.teamId.length > 0) log.teamId = data.teamId

  if (event.type === 'team/member' && data.member !== null && typeof data.member === 'object') {
    log.members.set(String(data.member.id), data.member)
  } else if (event.type === 'team/task' && data.task !== null && typeof data.task === 'object') {
    log.tasks.set(String(data.task.id), data.task)
  } else if (
    event.type === 'team/message/queued' &&
    data.message !== null &&
    typeof data.message === 'object'
  ) {
    const id = String(data.message.id)
    const existing = log.messages.get(id)
    // A re-append of the same message (e.g. a replay after a fork) must not
    // duplicate the row: latest seq/time wins, the body is the same value.
    if (existing === undefined) {
      log.messages.set(id, {
        message: data.message,
        seq: Number.isFinite(seq) ? seq : null,
        time: Number.isFinite(time) ? time : null,
      })
    } else {
      existing.message = data.message
      if (Number.isFinite(seq)) existing.seq = seq
      if (Number.isFinite(time)) existing.time = time
    }
  } else if (event.type === 'team/message/delivered' && typeof data.messageId === 'string') {
    log.delivered.add(data.messageId)
  }

  log.applied += 1
  return true
}

/**
 * Fold a slice of a Session log into the projection, in order.
 *
 * @param {object} log
 * @param {readonly object[]} events
 * @returns {number} how many events belonged to the team.
 */
export function applyTeamEvents(log, events) {
  if (Array.isArray(events) !== true) return 0
  let applied = 0
  for (const event of events) {
    if (applyTeamEvent(log, event)) applied += 1
  }
  return applied
}

/**
 * The projection as JSON, ordered the way the log orders it.
 *
 * `messages` is the only ordered table (it is a timeline); members and tasks are
 * whole-value records and keep insertion order. Deleted tasks are dropped here
 * for the same reason the client's own fold drops them: the task board keeps
 * tombstones, a chat view should not render them.
 *
 * @param {object} log
 * @returns {{
 *   teamId: string | null, lastSeq: number, applied: number,
 *   members: object[], tasks: object[],
 *   messages: { message: object, seq: number | null, time: number | null, delivered: boolean }[],
 * }}
 */
export function serializeTeamLog(log) {
  const messages = [...log.messages.values()]
    .slice()
    .sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0))
    .map((row) => ({
      message: row.message,
      seq: row.seq,
      time: row.time,
      delivered: log.delivered.has(String(row.message.id)),
    }))

  return {
    teamId: log.teamId,
    lastSeq: log.lastSeq,
    applied: log.applied,
    members: [...log.members.values()],
    tasks: [...log.tasks.values()].filter((task) => task.status !== 'deleted'),
    messages,
  }
}
