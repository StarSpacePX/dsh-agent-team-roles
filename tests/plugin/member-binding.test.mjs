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

test('bindMembers rebinds a delegated member to the role its label names', async () => {
  await withPlugin(
    async (harness) => {
      const { selected } = harness
      const agent = fakeChild('reviewer')
      // §5.53 — the role is bound inside the creation window, before the child is
      // announced, so a creation is what drives it now (not `agent/created`).
      await createMember(harness, { child: agent })
      assert.deepEqual(
        selected.map((entry) => entry.preset),
        ['team-reviewer'],
      )
      assert.equal(selected[0].agent, agent)
    },
    REVIEWER,
    { bindMembers: true },
    { agents: true },
  )
})

test('binding is off by default, so a delegation keeps inheriting the parent preset', async () => {
  await withPlugin(
    async ({ selected, emit }) => {
      await emit('agent/created', { agent: fakeChild('reviewer'), source: 'fresh' })
      assert.deepEqual(selected, [])
    },
    REVIEWER,
  )
})

//#region §5.46 — the deterministic member→role path

test('§5.46 the member name is the preset id without its prefix, hashed for a Chinese role name', () => {
  // The id already carries the slug, so a Chinese name needs no pinyin: the
  // hash fallback inside `slugify` is exactly what makes the key expressible.
  assert.equal(memberNameForRole({ id: 'team-r1abc' }, 'team-'), 'r1abc')
  assert.equal(memberNameForRole({ id: 'team-reviewer' }, 'team-'), 'reviewer')
  // No prefix in the id, or no prefix asked for: unchanged.
  assert.equal(memberNameForRole({ id: 'r1abc' }, 'team-'), 'r1abc')
  assert.equal(memberNameForRole({ id: 'team-r1abc' }, ''), 'team-r1abc')
  assert.equal(memberNameForRole(null, 'team-'), '')
  assert.equal(memberNameForRole({}, 'team-'), '')
})

test('§5.46 a role is found by Team name, never by its human name', () => {
  const roles = [
    { id: 'team-reviewer', name: 'reviewer', overrides: {} },
    { id: 'team-r1abc', name: '架构师', overrides: {} },
    { id: 'team-broken', name: '坏的', invalid: true, overrides: {} },
  ]
  assert.equal(roleForMemberName(roles, 'reviewer', 'team-').id, 'team-reviewer')
  assert.equal(roleForMemberName(roles, 'R1ABC', 'team-').id, 'team-r1abc', 'case-insensitive')
  assert.equal(roleForMemberName(roles, 'team-r1abc', 'team-').id, 'team-r1abc', 'the full id works too')
  assert.equal(roleForMemberName(roles, '架构师', 'team-'), undefined, 'a Chinese name is not a member name')
  assert.equal(roleForMemberName(roles, 'nobody', 'team-'), undefined)
  assert.equal(roleForMemberName(roles, '   ', 'team-'), undefined)
  assert.equal(roleForMemberName(roles, 'broken', 'team-'), undefined, 'a damaged role is never bound')
  assert.equal(roleForMemberName(undefined, 'reviewer', 'team-'), undefined)
})

test('§5.46 a teammate binds by its Team name even when the description names no role', async () => {
  await withPlugin(
    async (harness) => {
      const { selected, teamState, log } = harness
      // `spawn_teammate` passes the free-form `description` as the descriptor
      // label (…\dsh-experimental-agent-team\lib\index.js:576) — Chinese prose the
      // old label-only match could never resolve. The Team name is the fact, and
      // the creation window reads it off the Lead's durable roster
      // (`listMembers(lead)`), because the child is not registered yet.
      const agent = fakeChild('帮我写一份实现方案，越详细越好')
      teamState.rows = [{ id: 'session-member', name: 'r1abc', role: 'teammate', status: 'provisioning' }]
      await createMember(harness, { child: agent })

      assert.deepEqual(
        selected.map((entry) => entry.preset),
        ['team-r1abc'],
      )
      const info = log.find((entry) => entry.level === 'info' && entry.message.includes('已绑定角色'))
      assert.ok(info, 'the binding is reported')
      assert.match(info.message, /成员 r1abc/)
      assert.match(info.message, /来源 成员名/)
    },
    CHINESE_ROLE,
    { bindMembers: true },
    { agentTeams: true },
  )
})

test('§5.46 the Team name outranks a descriptor label that names another role', async () => {
  await withPlugin(
    async (harness) => {
      const { selected, teamState } = harness
      const agent = fakeChild('reviewer')
      teamState.rows = [{ id: 'session-member', name: 'r1abc', role: 'teammate', status: 'provisioning' }]
      await createMember(harness, { child: agent })

      assert.deepEqual(
        selected.map((entry) => entry.preset),
        ['team-r1abc'],
        'the runtime-validated name wins over the label',
      )
    },
    {
      version: 1,
      roles: [
        { id: 'team-reviewer', name: 'reviewer', description: '', order: 10, overrides: {} },
        { id: 'team-r1abc', name: '架构师', description: '', order: 20, overrides: {} },
      ],
    },
    { bindMembers: true },
    { agentTeams: true },
  )
})

test('§5.46 a plain subagent still binds by its label, and a runtime without Agent Teams changes nothing', async () => {
  await withPlugin(
    async (harness) => {
      const { selected, log } = harness
      // Not a Team member: `listMembers` has no row for the child, so the label is
      // all there is — and it still works, exactly as before §5.46.
      await createMember(harness, { child: fakeChild('reviewer') })
      assert.deepEqual(
        selected.map((entry) => entry.preset),
        ['team-reviewer'],
      )
      const info = log.find((entry) => entry.level === 'info' && entry.message.includes('已绑定角色'))
      assert.match(info.message, /来源 描述/)
    },
    REVIEWER,
    { bindMembers: true },
    { agentTeams: true },
  )
})

test('§5.46 the roster hands the Lead the exact spawn name of every role', () => {
  const text = rosterText(
    [],
    [
      { id: 'team-r1abc', name: '架构师', overrides: {} },
      { id: 'team-reviewer', name: 'reviewer', overrides: {} },
      { id: 'team-broken', name: '坏的', invalid: true, overrides: {} },
    ],
    'team-',
  )
  assert.match(text, /<team-roster>/)
  // 每个角色一行、建没建都有这一行（用户 m17306：没建的只是状态 vacant），
  // 标签里只放行、叙述句在标签外（用户 m17317）。
  assert.match(text, /<team-roster>\n- r1abc（vacant）\n- reviewer（vacant）\n<\/team-roster>/)
  assert.match(text, /<team-roles>/)
  assert.match(text, /- 「架构师」 → name 用 "r1abc"/)
  assert.match(text, /- 「reviewer」 → name 用 "reviewer"/)
  assert.ok(text.includes(ROSTER_ROLE_LINE))
  assert.ok(!text.includes('坏的'), 'a damaged role is not advertised as spawnable')

  // A getter is supported, so a role added mid-session shows up in the next turn.
  assert.match(rosterText([], () => [{ id: 'team-reviewer', name: 'reviewer', overrides: {} }], 'team-'), /reviewer/)

  // Nothing to say at all: no members and no roles contributes nothing.
  assert.equal(rosterText([], [], 'team-'), '')
  assert.equal(rosterText(undefined, undefined, 'team-'), '')
})

//#endregion

test('a refused binding is reported and never escapes the creation window', async () => {
  await withPlugin(
    async (harness) => {
      const { selected, log, selectFailure } = harness
      // The registry refuses a session that has already started.
      selectFailure.message = 'agent-preset/locked: This session has already started'
      let callerSetupRan = false
      // §5.53 — the composed `setup` is awaited by `agents.create` itself, so this
      // await is the assertion: a rejection here would tear the whole creation
      // down, taking the caller's own setup (and every other step) with it.
      await createMember(harness, {
        child: fakeChild('reviewer'),
        setup: async () => {
          callerSetupRan = true
        },
      })

      assert.equal(callerSetupRan, true, "the caller's own setup is never skipped")
      assert.deepEqual(selected, [], 'nothing was committed')
      const warning = log.find((entry) => entry.level === 'warn')
      assert.ok(warning, 'the refusal is visible in the log')
      assert.ok(warning.message.includes('session-member'), 'the log names the child that failed')
      assert.ok(warning.message.includes('agent-preset/locked'))
      assert.equal(
        log.some((entry) => entry.level === 'error'),
        false,
      )
    },
    REVIEWER,
    { bindMembers: true },
    { agents: true },
  )
})

test('the first descriptor wins, which is the one dsh treats as authoritative', async () => {
  await withPlugin(
    async (harness) => {
      const { selected } = harness
      // `foldSubagentDescriptor` documents that "the establishing provider
      // appends exactly one, so a later same-type event cannot rewrite the
      // declared composition" … and folds with `find`, i.e. the first. Both
      // labels name a real role here, so a last-wins scan would pick the wrong
      // one relative to how dsh itself classifies the child.
      const agent = fakeChild(undefined, undefined, [
        {
          type: 'subagent/descriptor',
          seq: 0,
          data: { version: 3, mode: 'continuable', provider: 'spawn', label: 'reviewer' },
        },
        { type: 'team/message/queued', seq: 3, data: {} },
        {
          type: 'subagent/descriptor',
          seq: 9,
          data: { version: 3, mode: 'continuable', provider: 'spawn', label: 'architect' },
        },
      ])
      await createMember(harness, { child: agent })
      assert.deepEqual(
        selected.map((entry) => entry.preset),
        ['team-reviewer'],
      )
    },
    {
      version: 1,
      roles: [
        { id: 'team-reviewer', name: 'reviewer', description: '', order: 10, overrides: {} },
        { id: 'team-reviewer', name: 'architect', description: '', order: 20, overrides: {} },
      ],
    },
    { bindMembers: true },
    { agents: true },
  )
})

test('a descriptor with no creation label binds nothing', async () => {
  await withPlugin(
    async ({ selected, emit, log }) => {
      // `label` is optional on a one-shot descriptor, so a labelled role must
      // not be guessed from the label's absence.
      await emit('agent/created', { agent: fakeChild(undefined), source: 'fresh' })
      assert.deepEqual(selected, [])
      assert.equal(
        log.some((entry) => entry.level === 'error'),
        false,
      )
    },
    REVIEWER,
    { bindMembers: true },
  )
})

test('only a labelled delegated child whose label names a role is rebound', async () => {
  await withPlugin(
    async ({ selected, emit }) => {
      // The label names no role.
      await emit('agent/created', { agent: fakeChild('nobody'), source: 'fresh' })
      // A top-level session has no delegating parent.
      await emit('agent/created', { agent: fakeChild('reviewer', { origin: 'fresh' }), source: 'fresh' })
      // A delegated child whose log carries no descriptor yet.
      await emit('agent/created', {
        agent: {
          session: {
            header: { parentSession: 'session-lead', delegationDepth: 1 },
            ownEvents: () => [],
          },
        },
        source: 'fresh',
      })
      assert.deepEqual(selected, [])
    },
    REVIEWER,
    { bindMembers: true },
  )
})
