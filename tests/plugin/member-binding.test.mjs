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

test('bindMembers rebinds a delegated member to the role its label names', async () => {
  await withPlugin(
    async (harness) => {
      const { selected } = harness
      const agent = fakeChild('reviewer')
// 角色在创建窗口里绑定，早于子代理被公开宣布，所以现在驱动它的是创建，不再监听 agent/created。
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

// ---- 确定性的成员 → 角色路径 ----

test('§5.46 the member name is the preset id without its prefix, hashed for a Chinese role name', () => {
// id 已经带 slug，中文名也不需要拼音：slugify 的哈希兜底正是让 key 能表达的原因。
  assert.equal(memberNameForRole({ id: 'team-r1abc' }, 'team-'), 'r1abc')
  assert.equal(memberNameForRole({ id: 'team-reviewer' }, 'team-'), 'reviewer')
// id 里没有前缀，或者没要求前缀：原样不动。
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
// spawn_teammate 把自由文本 description 当描述符 label，而旧的只匹配 label 的做法解析不了中文散文。
// 团队名才是事实，创建窗口从 Lead 的持久名册（listMembers(lead)）读它，因为子代理还没注册。
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
// 不是团队成员：listMembers 里没有这个子代理的行，只剩 label —— 它照样能用，与之前一致。
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
// 每个角色一行，建没建都有这一行（没建的只是状态 vacant）；标签里只放行，叙述句在标签外。
  assert.match(text, /<team-roster>\n- r1abc（vacant）\n- reviewer（vacant）\n<\/team-roster>/)
  assert.match(text, /<team-roles>/)
  assert.match(text, /- 「架构师」 → name 用 "r1abc"/)
  assert.match(text, /- 「reviewer」 → name 用 "reviewer"/)
  assert.ok(text.includes(ROSTER_ROLE_LINE))
  assert.ok(!text.includes('坏的'), 'a damaged role is not advertised as spawnable')

// 支持 getter，所以会话中途新增的角色下一轮就能看到。
  assert.match(rosterText([], () => [{ id: 'team-reviewer', name: 'reviewer', overrides: {} }], 'team-'), /reviewer/)

// 什么都说不出：没有成员也没有角色就什么都不贡献。
  assert.equal(rosterText([], [], 'team-'), '')
  assert.equal(rosterText(undefined, undefined, 'team-'), '')
})

//#endregion

test('a refused binding is reported and never escapes the creation window', async () => {
  await withPlugin(
    async (harness) => {
      const { selected, log, selectFailure } = harness
// 注册表拒绝已经开始过的会话。
      selectFailure.message = 'agent-preset/locked: This session has already started'
      let callerSetupRan = false
// 组合出来的 setup 由 agents.create 自己 await，所以这个 await 就是断言：
// 这里 reject 会把整个创建拖垮，连调用方自己的 setup 和其它步骤一起带走。
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
// foldSubagentDescriptor 记的是「建立 provider 恰好追加一条，之后同类型事件不能改写声明的组合」，
// 折的时候用 find（取第一条）。这里两个 label 都指向真角色，取最新会选错，与 dsh 自己的分类不一致。
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
// 一次性描述符的 label 是可选的，所以带 label 的角色不能靠「label 缺失」去猜。
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
// label 没指名任何角色。
      await emit('agent/created', { agent: fakeChild('nobody'), source: 'fresh' })
// 顶层会话没有委派父级。
      await emit('agent/created', { agent: fakeChild('reviewer', { origin: 'fresh' }), source: 'fresh' })
// 委派出来的子代理，日志里还没有描述符。
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
