/**
 * 《群聊》的历史：宿主侧的日志投影。
 *
 * 客户端只能读到会话日志的一个有界窗口（2.89 万条的会话里窗口只有 1041 条，早先的 team/*
 * 记录正好在窗口外），于是「团队明明工作过、页签却说本会话没有群聊记录」。所以投影放在
 * 宿主侧：Lead 的会话事件日志就是权威，折叠成三张表由网页端按需取，不需要别人装 pg。
 *
 * @module dsh-agent-team-roles/team-log
 */

/** 团队运行时往 Lead 日志里追加的四种事件。 */
export const TEAM_EVENT_TYPES = Object.freeze([
  'team/member',
  'team/task',
  'team/message/queued',
  'team/message/delivered',
])

/** 一份空投影。
 * messages 按消息 id 索引（正文只出现在持久入队那一条，delivered 只带 id），
 * members/tasks 是整值记录，同一个 id 的最新事件胜出。
 * @returns {object} 投影 */
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

/** 把一条原始会话事件折叠进投影。
 * @param {object} log @param {object} event 原始 SessionEvent（{ type, seq, time, data }）
 * @returns {boolean} 该事件是否属于团队 */
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
// 同一条消息重放（fork 之后）不能重复出一行：seq/time 取最新，正文是同一个值。
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

/** 按顺序把一段会话日志折叠进投影。
 * @param {object} log @param {readonly object[]} events
 * @returns {number} 属于团队的事件数 */
export function applyTeamEvents(log, events) {
  if (Array.isArray(events) !== true) return 0
  let applied = 0
  for (const event of events) {
    if (applyTeamEvent(log, event)) applied += 1
  }
  return applied
}

/** 投影的 JSON 形式，按日志的顺序排。
 * messages 是唯一有序表（它是时间线）；members/tasks 是整值记录，保持插入顺序。
 * 已删除的任务在这里丢弃：任务板留墓碑，群聊不该渲染它们。
 * @param {object} log @returns {object} */
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
