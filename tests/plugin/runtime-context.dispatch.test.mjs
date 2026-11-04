/** 运行时上下文（名册 / 任务唤醒 / @ 派发）。
 * 从 tests/plugin.test.mjs 拆分而来（超 400 行红线），测试体只做了 import 路径加深一层。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'
import { apply } from '../../lib/index.js'
import { LEAD_DISPATCH_LINES, TEAMMATE_REPLY_LINES, TEAMMATE_STYLE_LINE } from '../../lib/team-roster.js'
import { NOTICE_MAX_PER_SESSION, NOTICE_SOURCE, idleMembers } from '../../lib/team-watch.js'
import { call, withPlugin } from '../support/harness.mjs'
import { fakeAgent, rosterUp, taskRow, COMMAND_URL } from '../support/plugin-fixtures.mjs'

//#region §5.44 — 事件驱动派发：任务板变化会唤醒 Lead（用户 m10481 的第三条）

/** A `TeamTaskView` with the fields the watcher reads, and sane defaults for the rest. */

test('§5.44 a startable unowned task wakes an idle Lead exactly once per revision', async () => {
  await withPlugin(
    async (harness) => {
      const lead = rosterUp(harness, 'lead', [
        { id: 's1', name: 'lead', role: 'lead', status: 'inactive' },
        { id: 'm1', name: '架构师', role: 'teammate', status: 'inactive' },
      ])
      harness.teamState.tasks = [taskRow('t1', { subject: '写测试' })]
      await harness.emit('agent/created', { agent: lead.agent })

      const event = { type: 'team/task', data: { teamId: 's1', task: { id: 't1', revision: 1 } } }
      await lead.fire('session/event', {}, event)

      assert.equal(lead.notices.length, 1)
      const [notice] = lead.notices
      assert.equal(notice.role, 'user')
      assert.equal(notice.content[0].type, 'text')
      assert.match(notice.content[0].text, /t1「写测试」/)
      assert.match(notice.content[0].text, /还没有人认领/)
      assert.deepEqual(notice.source, NOTICE_SOURCE)
      assert.equal(typeof notice.id, 'string')

      // The same revision is not worth a second turn …
      await lead.fire('session/event', {}, event)
      assert.equal(lead.notices.length, 1)

      // … but a changed task is a new fact.
      harness.teamState.tasks = [taskRow('t1', { subject: '写测试', revision: 2 })]
      await lead.fire('session/event', {}, event)
      assert.equal(lead.notices.length, 2)
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )
})

test('§5.44 a running Lead and a calm board are both left alone', async () => {
  await withPlugin(
    async (harness) => {
      const lead = rosterUp(harness, 'lead', [{ id: 's1', name: 'lead', role: 'lead', status: 'running' }])
      harness.teamState.tasks = [taskRow('t1')]
      await harness.emit('agent/created', { agent: lead.agent })
      const event = { type: 'team/task', data: { teamId: 's1' } }

      // The Lead is mid-turn: it is already reading its own board.
      await lead.fire('session/event', {}, event)
      assert.equal(lead.notices.length, 0)

      harness.teamState.rows = [
        { id: 's1', name: 'lead', role: 'lead', status: 'inactive' },
        { id: 'm1', name: '架构师', role: 'teammate', status: 'inactive' },
      ]
      harness.teamState.tasks = [
        taskRow('t2', { ready: false }), // still blocked
        taskRow('t3', { status: 'completed' }), // finished
        taskRow('t4', { status: 'in_progress', ownerName: '架构师' }), // someone is on it
      ]
      await lead.fire('session/event', {}, event)
      assert.equal(lead.notices.length, 0)

      // Only board changes are interesting.
      await lead.fire('session/event', {}, { type: 'team/member', data: { teamId: 's1' } })
      assert.equal(lead.notices.length, 0)
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )
})

test('§5.44 a stranded owner is reported, the budget caps the noise, and disposal stops the watch', async () => {
  await withPlugin(
    async (harness) => {
      const lead = rosterUp(harness, 'lead', [{ id: 's1', name: 'lead', role: 'lead', status: 'inactive' }])
      harness.teamState.tasks = [taskRow('t1', { status: 'in_progress', ownerName: '幽灵' })]
      await harness.emit('agent/created', { agent: lead.agent })
      const event = { type: 'team/task', data: { teamId: 's1' } }

      // A runtime that is gone is a warning, never a broken event dispatch.
      harness.teamState.failure = 'team runtime is gone'
      await lead.fire('session/event', {}, event)
      assert.equal(lead.notices.length, 0)
      assert.equal(
        harness.log.some((entry) => entry.level === 'warn' && /任务板监听失败/.test(entry.message)),
        true,
      )
      harness.teamState.failure = null

      await lead.fire('session/event', {}, event)
      assert.equal(lead.notices.length, 1)
      assert.match(lead.notices[0].content[0].text, /负责人 幽灵/)

      // Every new revision wants a turn; the session budget is what stops it.
      for (let revision = 2; revision <= NOTICE_MAX_PER_SESSION + 4; revision += 1) {
        harness.teamState.tasks = [taskRow('t1', { status: 'in_progress', ownerName: '幽灵', revision })]
        await lead.fire('session/event', {}, event)
      }
      assert.equal(lead.notices.length, NOTICE_MAX_PER_SESSION)

      await harness.emit('agent/disposed', { agent: lead.agent })
      assert.equal(lead.listenerCount('session/event'), 0)
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )
})

test('§5.44 idleMembers only names teammates, and only while work is waiting', () => {
  const members = [
    { name: 'lead', role: 'lead', status: 'inactive' },
    { name: '架构师', role: 'teammate', status: 'inactive' },
    { name: 'reviewer', role: 'teammate', status: 'running' },
    { name: '幽灵', role: 'teammate', status: 'inactive' },
  ]
  const names = (rows) => rows.map((row) => row.name)

  // 没有等人认领的活时，「谁空闲」不值得开一轮。
  assert.deepEqual(names(idleMembers(members, [])), [])
  assert.deepEqual(names(idleMembers(members, null)), [])
  assert.deepEqual(names(idleMembers(members, [taskRow('t9', { status: 'completed' })])), [])
  // 有人可以接手时，空闲的**成员**才成为事实（Lead 与在跑的除外）。
  assert.deepEqual(names(idleMembers(members, [taskRow('t1')])), ['架构师', '幽灵'])
  assert.deepEqual(names(idleMembers(undefined, [taskRow('t1')])), [])
})

test('§5.44 a teammate finishing its turn tells the Lead about the waiting work', async () => {
  await withPlugin(
    async (harness) => {
      const rows = [
        { id: 's1', name: 'lead', role: 'lead', status: 'inactive' },
        { id: 'm1', name: '架构师', role: 'teammate', status: 'inactive', model: 'deepseek-flash' },
      ]
      const lead = rosterUp(harness, 'lead', rows)
      const mate = rosterUp(harness, 'teammate', rows)
      harness.teamState.tasks = [taskRow('t1', { subject: '写测试' })]
      await harness.emit('agent/created', { agent: lead.agent })

      // 成员一轮跑完：agent 事件那一路上看到 idle。
      await harness.emit('agent/status', { agent: mate.agent, status: 'idle' })
      assert.equal(lead.notices.length, 1)
      const [notice] = lead.notices
      assert.match(notice.content[0].text, /t1「写测试」/)
      assert.match(notice.content[0].text, /架构师/)
      assert.match(notice.content[0].text, /空闲/)
      assert.deepEqual(notice.source, NOTICE_SOURCE)

      // 同一批空闲成员不重复打扰。
      await harness.emit('agent/status', { agent: mate.agent, status: 'idle' })
      assert.equal(lead.notices.length, 1)

      // 忙起来的那一下不是「空闲」。
      harness.teamState.rows = [rows[0], { ...rows[1], status: 'running' }]
      await harness.emit('agent/status', { agent: mate.agent, status: 'running' })
      assert.equal(lead.notices.length, 1)

      // 板上没有等人认领的活 → 成员空闲也闭嘴。
      harness.teamState.rows = rows
      harness.teamState.tasks = [taskRow('t2', { status: 'completed' })]
      await harness.emit('agent/status', { agent: mate.agent, status: 'idle' })
      assert.equal(lead.notices.length, 1)

      // Lead 自己的轮次结束不许再把自己叫醒（换一个 revision 让去重挡不住它）。
      harness.teamState.tasks = [taskRow('t1', { subject: '写测试', revision: 2 })]
      await harness.emit('agent/status', { agent: lead.agent, status: 'idle' })
      assert.equal(lead.notices.length, 1)

      // 装上之后卸掉：dispose 必须把 agent 事件这条监听也摘掉。
      await harness.emit('agent/disposed', { agent: lead.agent })
      await harness.emit('agent/status', { agent: mate.agent, status: 'idle' })
      assert.equal(lead.notices.length, 1)
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )
})

//#endregion
