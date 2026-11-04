/** 成员绑定与角色名。
 * 从 tests/plugin.test.mjs 拆分而来（超 400 行红线），测试体只做了 import 路径加深一层的机械调整。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { memberNameForRole, roleForMemberName } from '../../lib/roles.js'
import { ROSTER_ROLE_LINE, rosterText } from '../../lib/team-roster.js'
import { call, withPlugin } from '../support/harness.mjs'
import path from 'node:path'
import { fakeChild, REVIEWER, LEAD_AGENT, createMember, CHINESE_ROLE, STATE_URL, COMMAND_URL } from '../support/plugin-fixtures.mjs'

//#region §5.53 — the role is bound inside the creation window

/** 绑定从 agent/created 挪进了 dsh 自己挂载预设的那个窗口。这里锁住的契约：
 * 两个入口都组合（不替换）调用方的 setup；解析顺序与幂等性不变；拒绝被吞掉；
 * announce 监听留作兜底，且不碰已经绑好的子代理。 */

test('§5.53 agents.create binds the role inside the creation window', async () => {
  await withPlugin(
    async (harness) => {
      const { selected, log, creation, effects } = harness
      assert.ok(
        effects.some((effect) => effect.label === 'agent-team-roles: creation window'),
        'the wrapper is installed as its own effect',
      )
      assert.ok(log.some((entry) => entry.message.includes('§5.53 角色绑定已装到创建窗口')))

      const agent = fakeChild('reviewer')
      await createMember(harness, { child: agent, childCtx: { fiber: { uid: 3 } } })

      assert.deepEqual(selected.map((entry) => entry.preset), ['team-reviewer'])
      assert.equal(selected[0].agent, agent, 'select() is handed the child itself')
// 调用方的请求是**组合**进去的，绝不替换。
      assert.equal(creation[0].method, 'create')
      assert.equal(creation[0].params.sessionId, 'session-member')
      assert.equal(creation[0].params.parentAgent, LEAD_AGENT)
    },
    REVIEWER,
    { bindMembers: true },
    { agents: true },
  )
})

test('§5.53 agents.resume binds a resumed child the same way', async () => {
  await withPlugin(
    async (harness) => {
      const { selected, creation } = harness
      const agent = fakeChild('reviewer')
// resume 带的是 resumeSessionId 而不是 sessionId —— 它仍是名册用来索引的成员 id。
      await createMember(harness, { method: 'resume', child: agent })

      assert.deepEqual(selected.map((entry) => entry.preset), ['team-reviewer'])
      assert.equal(selected[0].agent, agent)
      assert.equal(creation[0].method, 'resume')
    },
    REVIEWER,
    { bindMembers: true },
    { agents: true },
  )
})

test('§5.53 without an Agent Teams runtime the descriptor label still names the role', async () => {
  await withPlugin(
    async (harness) => {
      const { selected, log } = harness
// ctx.get('agentTeams') 是 undefined，没有名册可读，只剩 label 兜底那条路。
      assert.equal(harness.ctx.get('agentTeams'), undefined)
      await createMember(harness, { child: fakeChild('reviewer') })
      assert.deepEqual(selected.map((entry) => entry.preset), ['team-reviewer'])
      const info = log.find((entry) => entry.level === 'info' && entry.message.includes('已绑定角色'))
      assert.match(info.message, /来源 描述/)
    },
    REVIEWER,
    { bindMembers: true },
    { agents: true },
  )
})

test('§5.53 a child already composed into the role is not selected twice', async () => {
  await withPlugin(
    async (harness) => {
      const { selected, composedState } = harness
      composedState.preset = 'team-reviewer'
      await createMember(harness, { child: fakeChild('reviewer') })
      assert.deepEqual(selected, [], 'idempotent: an already-correct composition is left alone')
    },
    REVIEWER,
    { bindMembers: true },
    { agents: true },
  )
})

test('§5.53 the announce leaves an already-bound child alone', async () => {
  await withPlugin(
    async (harness) => {
      const { selected, emit, composedState } = harness
// 创建窗口已经选好角色，监听不能再绑一次：那会在 preset-standard 的常驻 tool-subagent 监听
// 还在加载注入 fiber 时改写子代理的作用域链，把整次创建回滚（INACTIVE_EFFECT）。
      composedState.preset = 'team-reviewer'
      await emit('agent/created', { agent: fakeChild('reviewer'), source: 'fresh' })
      assert.deepEqual(selected, [])
    },
    REVIEWER,
    { bindMembers: true },
    { agents: true },
  )
})

test('§5.53 a creation that bypasses the window is still bound at the announce', async () => {
  await withPlugin(
    async (harness) => {
      const { selected, emit } = harness
// 根本没有 agents.create / resume 调用：这是给不走被包装方法的创建路径留的兜底。
      await emit('agent/created', { agent: fakeChild('reviewer'), source: 'fresh' })
      assert.deepEqual(selected.map((entry) => entry.preset), ['team-reviewer'])
    },
    REVIEWER,
    { bindMembers: true },
    { agents: true },
  )
})

test('§5.53 disposing the plugin restores agents.create and agents.resume', async () => {
  await withPlugin(
    async (harness) => {
      const { agents, agentsOriginal, effects } = harness
// 插件加载时两个入口都被包上……
      assert.notEqual(agents.create, agentsOriginal.create)
      assert.notEqual(agents.resume, agentsOriginal.resume)

      const effect = effects.find((entry) => entry.label === 'agent-team-roles: creation window')
      assert.ok(effect, 'the wrapper is its own effect')
      await effect.dispose()

// ……并在卸载时还原，重载不会在服务上留下死钩子。
      assert.equal(agents.create, agentsOriginal.create)
      assert.equal(agents.resume, agentsOriginal.resume)
    },
    REVIEWER,
    { bindMembers: true },
    { agents: true },
  )
})

//#endregion
