/**
 * Unit tests for the host-side 群聊 projection (§5.50).
 *
 * What matters here is that the projection is a *faithful fold of the log*:
 * latest-wins for whole-value records, delivery as a second pass, and no
 * invented rows. The host half's paging cursors are covered in
 * `tests/plugin/log.test.mjs` (the source assertions), because they need
 * a fake Session.
 */
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

test('§5.50 the projection only knows the four team event types', () => {
  assert.deepEqual([...TEAM_EVENT_TYPES], [
    'team/member',
    'team/task',
    'team/message/queued',
    'team/message/delivered',
  ])

  const log = createTeamLog()
  // Ordinary Session traffic must leave no trace: no rows, no cursor move.
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

test('§5.50 whole-value records are latest-wins, messages are append-only', () => {
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

test('§5.50 delivery is a second pass, and deleting a task is a tombstone', () => {
  const log = createTeamLog()
  applyTeamEvents(log, [
    teamEvent('team/message/queued', { version: 2, teamId: 't-1', message: message('msg-1', 'lead', 'lead', 'm-1') }, 20),
    teamEvent('team/message/queued', { version: 2, teamId: 't-1', message: message('msg-2', 'lead', 'lead', 'm-1') }, 21),
    // Delivery of msg-2 lands *before* msg-1 in the log: order must not matter.
    teamEvent('team/message/delivered', { version: 2, teamId: 't-1', messageId: 'msg-2' }, 22),
    teamEvent('team/message/delivered', { version: 2, teamId: 't-1', messageId: 'msg-1' }, 23),
    teamEvent('team/task', { version: 2, teamId: 't-1', task: task('task-9', 'deleted') }, 24),
  ])

  const out = serializeTeamLog(log)
  assert.deepEqual(out.messages.map((row) => [row.message.id, row.delivered]), [['msg-1', true], ['msg-2', true]])
  assert.equal(out.tasks.length, 0, 'deleted 任务是墓碑，不进群聊视图')
})

test('§5.50 a replayed enqueue keeps one row and takes the newest seq', () => {
  const log = createTeamLog()
  applyTeamEvents(log, [
    teamEvent('team/message/queued', { version: 2, teamId: 't-1', message: message('msg-1', 'lead', 'lead', 'm-1') }, 30),
    // The same durable message re-appended by a replay (fork / folded history):
    // duplicating it would double the bubble in the chat view.
    teamEvent('team/message/queued', { version: 2, teamId: 't-1', message: message('msg-1', 'lead', 'lead', 'm-1') }, 41),
  ])

  const out = serializeTeamLog(log)
  assert.equal(out.messages.length, 1)
  assert.equal(out.messages[0].seq, 41)
  assert.equal(out.messages[0].time, 41000)
})

test('§5.50 messages come out in log order, not in Map insertion order', () => {
  const log = createTeamLog()
  // Deliberately out of order: a replay can hand the projector a later enqueue
  // first, and the timeline must still read left-to-right.
  applyTeamEvents(log, [
    teamEvent('team/message/queued', { version: 2, teamId: 't-1', message: message('msg-b', 'm-1', 'alpha', 'lead') }, 52),
    teamEvent('team/message/queued', { version: 2, teamId: 't-1', message: message('msg-a', 'lead', 'lead', 'm-1') }, 51),
  ])

  assert.deepEqual(serializeTeamLog(log).messages.map((row) => row.message.id), ['msg-a', 'msg-b'])
})

test('§5.50 folding is incremental: the same events applied twice are idempotent', () => {
  const log = createTeamLog()
  const events = [
    teamEvent('team/member', { version: 2, teamId: 't-1', member: member('m-1', 'alpha') }, 60),
    teamEvent('team/message/queued', { version: 2, teamId: 't-1', message: message('msg-1', 'lead', 'lead', 'm-1') }, 61),
    teamEvent('team/message/delivered', { version: 2, teamId: 't-1', messageId: 'msg-1' }, 62),
  ]
  applyTeamEvents(log, events)
  const first = serializeTeamLog(log)
  // The host reader hands the projector only the tail, but a repeated slice
  // (retry, double poll) must not change the answer.
  applyTeamEvents(log, events)
  const second = serializeTeamLog(log)
  assert.deepEqual({ ...second, applied: first.applied }, first)
  assert.equal(second.applied, 6, 'applied 数的是折叠次数，不是去重后的行数')
})

test('§5.50 one bad event never poisons the fold', () => {
  const log = createTeamLog()
  assert.equal(applyTeamEvent(log, { type: 'team/member', seq: 1, data: 'nope' }), false)
  assert.equal(applyTeamEvent(log, { type: 'team/task', seq: 2 }), false)
  assert.equal(applyTeamEvent(log, undefined), false)
  assert.equal(log.lastSeq, -1, '被拒绝的事件不推进游标')
  // A well-formed event that carries nothing still *is* a team event: it counts
  // as applied and its seq moves the cursor — no row appears.
  assert.equal(applyTeamEvent(log, { type: 'team/task', seq: 3, data: { task: null } }), true)
  assert.deepEqual(serializeTeamLog(log).tasks, [])
})
