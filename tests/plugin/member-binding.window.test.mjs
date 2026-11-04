/**
 * 成员绑定与角色名（§5.46 / §5.53 / 绑定开关）
 *
 * 批次 F4：从 tests/plugin.test.mjs 拆分而来。test() 回调体逐字未改，只有两类机械调整：
 * import 来源换成本目录的相对路径；测试体里 `new URL('../lib/…')` 加深一层为 `'../../lib/…'`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { memberNameForRole, roleForMemberName } from '../../lib/roles.js'
import { ROSTER_ROLE_LINE, rosterText } from '../../lib/team-roster.js'
import { call, withPlugin } from '../support/harness.mjs'
import path from 'node:path'
import { fakeChild, REVIEWER, LEAD_AGENT, createMember, CHINESE_ROLE, STATE_URL, COMMAND_URL } from '../support/plugin-fixtures.mjs'


//#region §5.53 — the role is bound inside the creation window

/**
 * §5.53 moved the binding off `agent/created` and into the window where dsh
 * itself mounts a preset. The contract the tests below lock: both entry points
 * compose (never replace) the caller's `setup`, the resolution order and the
 * idempotence are unchanged, a refusal is swallowed, and the announce listener
 * stays as a fallback that leaves an already-bound child alone.
 */

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
      // The caller's request is *composed*, never replaced.
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
      // A resume carries `resumeSessionId` instead of `sessionId` — it is the same
      // member id the roster is keyed by.
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
      // `ctx.get('agentTeams')` answers undefined, so there is no roster to read
      // and the label fallback is the only path left.
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
      // The window already selected the role, so the listener must not rebind it:
      // that rebind rewrites the child's scope chain while `preset-standard`'s
      // standing `tool-subagent` listener is still loading its injected fiber,
      // which is what used to roll the whole creation back (INACTIVE_EFFECT).
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
      // No `agents.create`/`resume` call at all: this is the fallback the plugin
      // keeps for a creation path that never goes through the wrapped methods.
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
      // Both entry points are wrapped while the plugin is loaded …
      assert.notEqual(agents.create, agentsOriginal.create)
      assert.notEqual(agents.resume, agentsOriginal.resume)

      const effect = effects.find((entry) => entry.label === 'agent-team-roles: creation window')
      assert.ok(effect, 'the wrapper is its own effect')
      await effect.dispose()

      // … and put back, so a reload never leaves a dead hook on the service.
      assert.equal(agents.create, agentsOriginal.create)
      assert.equal(agents.resume, agentsOriginal.resume)
    },
    REVIEWER,
    { bindMembers: true },
    { agents: true },
  )
})

//#endregion
