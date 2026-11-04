/**
 * 事件驱动的派发提醒（R4）。
 *
 * Team 运行时只提供「写入持久且可见」，部署里没有任何东西会对它反应。这一文件挂在 Lead 自己
 * 会话的作用域上听看板变化，把「可开始但没人接的任务」「负责人已不在名册」「有空闲成员又有
 * 没人接的活」合成一条 notice，用它唤醒 Lead 的 turn。
 *
 * @module dsh-agent-team-roles/team-watch
 */

import { randomUUID } from 'node:crypto'

/** 每个 Lead 会话的 notice 上限：一次自唤醒的 turn 不是免费的。 */
export const NOTICE_MAX_PER_SESSION = 8

/** 每个会话保留的去重键数，超出忘掉最旧的。 */
const REMEMBERED = 200

/** 每条 notice 携带的 source.kind：生产者自有，不用已废弃的 'plugin'。 */
export const NOTICE_SOURCE = { kind: 'agent-team-roles', plugin: '@deepseek-ai/dsh-agent-team-roles' }

/** id「subject」，有 subject 时才带。 */
function taskLabel(task) {
  const subject = typeof task.subject === 'string' ? task.subject.trim() : ''
  return subject.length > 0 ? `${task.id}「${subject}」` : task.id
}

/** 已变成可开始、仍没人接的任务。 */
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

/** 负责人已不在名册里的任务。 */
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

/** 有就绪的活没人接、同时有成员没在跑。
 * 「成员空闲」不是持久的 Team 事件：运行时在读取时才算可用性，只为创建和
 * provisioning 结束写 team/member，所以这一项要自己判断。 */
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

/** 一轮的 notice；不值得唤醒时返回 null。
 * @param {{ ready?: object[], stranded?: object[], idle?: object[] }} findings
 * @returns {{ key: string, text: string } | null} */
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
// 空闲集合参与身份判定：成员跑完一轮正是该出新 notice 的事件，同一集合不该重复出。
    ...(idle.length === 0 ? [] : [`idle:${idle.map((row) => row.name).join(',')}`]),
  ].join('|')
  return { key, text: lines.join('\n') }
}

/** 记一个键，超出上限忘掉最旧的，集合不会无限增长。 */
function remember(keys, key) {
  keys.add(key)
  while (keys.size > REMEMBERED) {
    const oldest = keys.values().next()
    if (oldest.done === true) break
    keys.delete(oldest.value)
  }
}

/** 监听一个 Lead 会话里需要 Lead 注意的看板变化。
 * 监听器要挂在 Lead 自己的 agent 作用域上：Team 事件按追加会话的 emit 上下文发布，
 * 挂在插件根上下文收不到。
 * @param {object} ctx @param {object} team @param {object} [options] @returns {Function} */
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
// Lead 正在自己的 turn 里：它已在看自己的看板，叫醒只会把两个 turn 交错。
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

// 返回 promise 是部署的分发约定：它调用监听器并吞掉 rejection；这里永不 reject，
// 看板读失败只会变成一条 warning。
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

// 成员刚跑完就不再是 running；没有这条通道，Lead 只能自己问才知道有成员空闲。
// 只有队员能这样叫醒 Lead：Lead 自己的 turn 结束会重开刚关掉的看板，普通子代理不属于 Team。
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
