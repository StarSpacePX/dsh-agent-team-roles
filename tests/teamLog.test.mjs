/** 宿主侧群聊投影的单元测试：投影必须是日志的忠实折叠 —— 整值记录取最新、送达是第二遍、不凭空造行。
 * 宿主分页游标的源码断言在 tests/plugin/log.test.mjs（那边需要假 Session）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  TEAM_EVENT_TYPES,
  applyTeamEvent,
  applyTeamEvents,
  createTeamLog,
  serializeTeamLog,
} from '../lib/team-log.js'

const member = (id, name, phase = 'active') => ({ id, name, phase })
const task = (id, status) => ({ id, status, subject: `task ${id}` })
const message = (id, senderId, senderName, targetId) => ({
  id,
  senderId,
  senderName,
  targetId,
  content: [{ type: 'text', text: `body ${id}` }],
})

const teamEvent = (type, data, seq, time = seq * 1000) => ({ type, seq, time, data })

test('the projection only knows the four team event types', () => {
  assert.deepEqual([...TEAM_EVENT_TYPES], [
    'team/member',
    'team/task',
    'team/message/queued',
    'team/message/delivered',
  ])

  const log = createTeamLog()
// 普通会话流量不留痕：没有行，游标也不动。
  const applied = applyTeamEvents(log, [
    teamEvent('turn/start', { turn: 1 }, 0),
    teamEvent('assistant/message', { message: {} }, 1),
    { type: 'team/member', seq: 2, data: null },
    null,
    'nonsense',
  ])
  assert.equal(applied, 0, '只有 team/* 事件才算数')
  assert.equal(log.lastSeq, -1)
  assert.deepEqual(serializeTeamLog(log), {
    teamId: null,
    lastSeq: -1,
    applied: 0,
    members: [],
    tasks: [],
    messages: [],
  })
})

test('whole-value records are latest-wins, messages are append-only', () => {
  const log = createTeamLog()
  const applied = applyTeamEvents(log, [
    teamEvent('team/member', { version: 2, teamId: 't-1', member: member('m-1', 'alpha', 'provisioning') }, 10),
    teamEvent('team/message/queued', { version: 2, teamId: 't-1', message: message('msg-1', 'lead', 'lead', 'm-1') }, 11),
    teamEvent('team/member', { version: 2, teamId: 't-1', member: member('m-1', 'alpha', 'active') }, 12),
    teamEvent('team/task', { version: 2, teamId: 't-1', task: task('task-1', 'pending') }, 13),
    teamEvent('team/task', { version: 2, teamId: 't-1', task: task('task-1', 'done') }, 14),
    teamEvent('team/message/queued', { version: 2, teamId: 't-1', message: message('msg-2', 'm-1', 'alpha', 'lead') }, 15),
  ])

  assert.equal(applied, 6)
  const out = serializeTeamLog(log)
  assert.equal(out.teamId, 't-1')
  assert.equal(out.lastSeq, 15)
  assert.equal(out.applied, 6)
  assert.deepEqual(out.members.map((row) => [row.id, row.phase]), [['m-1', 'active']])
  assert.deepEqual(out.tasks.map((row) => [row.id, row.status]), [['task-1', 'done']])
  assert.deepEqual(out.messages.map((row) => [row.message.id, row.seq]), [['msg-1', 11], ['msg-2', 15]])
  assert.deepEqual(out.messages.map((row) => row.delivered), [false, false], '没有 delivered 就是排队中')
})

test('delivery is a second pass, and deleting a task is a tombstone', () => {
  const log = createTeamLog()
  applyTeamEvents(log, [
    teamEvent('team/message/queued', { version: 2, teamId: 't-1', message: message('msg-1', 'lead', 'lead', 'm-1') }, 20),
    teamEvent('team/message/queued', { version: 2, teamId: 't-1', message: message('msg-2', 'lead', 'lead', 'm-1') }, 21),
// msg-2 的送达在日志里排在 msg-1 之前：顺序不能影响结果。
    teamEvent('team/message/delivered', { version: 2, teamId: 't-1', messageId: 'msg-2' }, 22),
    teamEvent('team/message/delivered', { version: 2, teamId: 't-1', messageId: 'msg-1' }, 23),
    teamEvent('team/task', { version: 2, teamId: 't-1', task: task('task-9', 'deleted') }, 24),
  ])

  const out = serializeTeamLog(log)
  assert.deepEqual(out.messages.map((row) => [row.message.id, row.delivered]), [['msg-1', true], ['msg-2', true]])
  assert.equal(out.tasks.length, 0, 'deleted 任务是墓碑，不进群聊视图')
})

test('a replayed enqueue keeps one row and takes the newest seq', () => {
  const log = createTeamLog()
  applyTeamEvents(log, [
    teamEvent('team/message/queued', { version: 2, teamId: 't-1', message: message('msg-1', 'lead', 'lead', 'm-1') }, 30),
// 同一条持久消息被 replay 再追加一遍（fork / 折叠历史）：重复会让聊天气泡翻倍。
    teamEvent('team/message/queued', { version: 2, teamId: 't-1', message: message('msg-1', 'lead', 'lead', 'm-1') }, 41),
  ])

  const out = serializeTeamLog(log)
  assert.equal(out.messages.length, 1)
  assert.equal(out.messages[0].seq, 41)
  assert.equal(out.messages[0].time, 41000)
})

test('messages come out in log order, not in Map insertion order', () => {
  const log = createTeamLog()
// 故意乱序：replay 可能先给投影器一个更晚的入队，时间线仍要从左到右读。
  applyTeamEvents(log, [
    teamEvent('team/message/queued', { version: 2, teamId: 't-1', message: message('msg-b', 'm-1', 'alpha', 'lead') }, 52),
    teamEvent('team/message/queued', { version: 2, teamId: 't-1', message: message('msg-a', 'lead', 'lead', 'm-1') }, 51),
  ])

  assert.deepEqual(serializeTeamLog(log).messages.map((row) => row.message.id), ['msg-a', 'msg-b'])
})

test('folding is incremental: the same events applied twice are idempotent', () => {
  const log = createTeamLog()
  const events = [
    teamEvent('team/member', { version: 2, teamId: 't-1', member: member('m-1', 'alpha') }, 60),
    teamEvent('team/message/queued', { version: 2, teamId: 't-1', message: message('msg-1', 'lead', 'lead', 'm-1') }, 61),
    teamEvent('team/message/delivered', { version: 2, teamId: 't-1', messageId: 'msg-1' }, 62),
  ]
  applyTeamEvents(log, events)
  const first = serializeTeamLog(log)
// 宿主读取器只把尾巴交给投影器，但重复的切片（重试、双轮询）不能改变答案。
  applyTeamEvents(log, events)
  const second = serializeTeamLog(log)
  assert.deepEqual({ ...second, applied: first.applied }, first)
  assert.equal(second.applied, 6, 'applied 数的是折叠次数，不是去重后的行数')
})

test('one bad event never poisons the fold', () => {
  const log = createTeamLog()
  assert.equal(applyTeamEvent(log, { type: 'team/member', seq: 1, data: 'nope' }), false)
  assert.equal(applyTeamEvent(log, { type: 'team/task', seq: 2 }), false)
  assert.equal(applyTeamEvent(log, undefined), false)
  assert.equal(log.lastSeq, -1, '被拒绝的事件不推进游标')
// 形状正确却什么都没带的事件仍然是团队事件：算作已应用、游标前进，但不出现行。
  assert.equal(applyTeamEvent(log, { type: 'team/task', seq: 3, data: { task: null } }), true)
  assert.deepEqual(serializeTeamLog(log).tasks, [])
})
