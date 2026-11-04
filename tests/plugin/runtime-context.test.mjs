/** 运行时上下文（名册 / 任务唤醒 / @ 派发）。
 * 从 tests/plugin.test.mjs 拆分而来（超 400 行红线），测试体只做了 import 路径加深一层。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { apply } from '../../lib/index.js'
import { LEAD_DISPATCH_LINES, TEAMMATE_REPLY_LINES, TEAMMATE_STYLE_LINE } from '../../lib/team-roster.js'
import { NOTICE_MAX_PER_SESSION, NOTICE_SOURCE, idleMembers } from '../../lib/team-watch.js'
import { defaultArbiterDir } from '../../lib/host/arbiter-workspace.js'
import { call, withPlugin } from '../support/harness.mjs'
import { fakeAgent, rosterUp, taskRow, COMMAND_URL } from '../support/plugin-fixtures.mjs'

/** 让 `refresh()` 之后的微任务链跑完（工作区是异步到的）。 */
async function flush() {
  for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

test('通信骨架的正文是 templates/通信骨架.md（js 里不再存一份）', async () => {
  const [md, pkg] = await Promise.all([
    readFile(new URL('../../templates/通信骨架.md', import.meta.url), 'utf8'),
    readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ])
  assert.match(md, /^<!--\s*lead\s*-->\s*$/m)
  assert.match(md, /^<!--\s*teammate\s*-->\s*$/m)
  assert.equal(TEAMMATE_STYLE_LINE, TEAMMATE_REPLY_LINES.join('\n'))
  assert.equal(LEAD_DISPATCH_LINES.includes('**待办**'), true)
  assert.equal(LEAD_DISPATCH_LINES.some((line) => line.startsWith('<!--')), false)
  assert.equal(JSON.parse(pkg).files.includes('templates'), true, 'templates 必须随包发布')
})

test('only the Lead gets the member roster', async () => {
  await withPlugin(
    async (harness) => {
      const rows = [
        { id: 'lead', name: 'lead', role: 'lead', status: 'running' },
        { id: 'm1', name: '架构师', role: 'teammate', status: 'running', description: '架构师', model: 'deepseek-flash' },
        { id: 'm2', name: 'reviewer', role: 'teammate', status: 'inactive' },
      ]
      const lead = rosterUp(harness, 'lead', rows)
      const mate = rosterUp(harness, 'teammate', rows)

      await harness.emit('agent/created', { agent: lead.agent })
      await harness.emit('agent/created', { agent: mate.agent })

// 成员拿到的不是名册，而是回报骨架。
      assert.deepEqual(mate.contexts.map((row) => row.name), ['agent-team-roles:chat-style'])
      assert.match(mate.contexts[0].text, /^回报就是你发给 lead 的/)
// 骨架必须绑定到「send_message 正文」这个动作上，否则模型当成风格建议、省掉 ## 。
  assert.match(LEAD_DISPATCH_LINES[0], /^派活就是你发给成员的/)
      assert.equal(mate.contexts[0].text.includes('**结论**'), true)
      assert.equal(mate.contexts[0].text.includes('**待办**'), true)
      assert.equal(mate.contexts[0].text.includes('**说明**'), true)
      assert.equal(lead.contexts.length, 1)
      const [roster] = lead.contexts
      assert.equal(roster.name, 'agent-team-roles:roster')
      assert.equal(roster.order, 130)
      assert.equal(typeof roster.text, 'function')

      const text = roster.text()
// 标签里只有行，叙述句在标签外。
      assert.match(text, /你是本会话的 Team Lead/)
      assert.match(text, /<team-roster>\n- 架构师（running，deepseek-flash）/)
      assert.match(text, /- 架构师（running，deepseek-flash）/)
// 已完成的成员也逐行带名字，不折叠成「已完成 N 人」这种没有名字的计数。
      assert.match(text, /- reviewer（inactive）/)
      assert.equal(text.includes('已完成'), false)
// ……而且 Lead 从不列自己：名册是它能 @ 的人。
      assert.equal(text.includes('- lead（'), false)
      assert.match(text, /send_message/)
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )
})

test('a roster with no teammates adds nothing, and a non-member agent is left alone', async () => {
  await withPlugin(
    async (harness) => {
      const lead = rosterUp(harness, 'lead', [{ id: 'lead', name: 'lead', role: 'lead', status: 'running' }])
      const stranger = fakeAgent()
      await harness.emit('agent/created', { agent: stranger.agent })
      await harness.emit('agent/created', { agent: lead.agent })

      assert.equal(stranger.contexts.length, 0)
      assert.equal(lead.contexts.length, 1)
      assert.equal(lead.contexts[0].text(), '')
      assert.equal(harness.log.some((entry) => entry.level === 'warn'), false)
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )
})

test('the roster follows the team and dies with its agent', async () => {
  await withPlugin(
    async (harness) => {
      const lead = rosterUp(harness, 'lead', [{ id: 'm1', name: '架构师', role: 'teammate', status: 'running' }])
      await harness.emit('agent/created', { agent: lead.agent })
      const [roster] = lead.contexts
      assert.match(roster.text(), /架构师（running）/)

// provider 抛错会让 prompt 组装失败，所以它不许抛。
      harness.teamState.failure = 'team runtime is gone'
      assert.equal(roster.text(), '')
      assert.equal(
        harness.log.some((entry) => entry.level === 'warn' && /成员名册读取失败/.test(entry.message)),
        true,
      )

      harness.teamState.failure = null
      harness.teamState.rows = [{ id: 'm1', name: '架构师', role: 'teammate', status: 'inactive' }]
      assert.match(roster.text(), /- 架构师（inactive）/)
      assert.equal(roster.text().includes('已完成'), false)

      await harness.emit('agent/disposed', { agent: lead.agent })
      assert.equal(roster.disposed, true)
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )
})

test('a member description that looks like a prompt variable cannot break assembly', async () => {
  await withPlugin(
    async (harness) => {
      const rows = [
        { id: 'lead', name: 'lead', role: 'lead', status: 'running' },
// description 是 spawn_teammate 的自由文本，运行时只约束 name。
// 它曾经跟着名册走到 interpolate()，那里遇到未知的 {{name}} 会抛；名册不再携带它，
// 这条钉住载荷不会意外回来……
        { id: 'm1', name: '架构师', role: 'teammate', status: 'running', description: '{{cwd}} 与 {{not_registered}}' },
// ……而 neutralBraces 仍有用：name 是另一个会到达同一处插值的用户可控字段。
        { id: 'm2', name: '{{cwd}}', role: 'teammate', status: 'running' },
      ]
      const lead = rosterUp(harness, 'lead', rows)
      await harness.emit('agent/created', { agent: lead.agent })

      const assembled = lead.render()
      assert.equal(assembled.includes('{{'), false)
      assert.equal(assembled.includes('not_registered'), false)
      assert.equal(assembled.includes('- 架构师（running）'), true)
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )
})

// 名册互斥：同一条会话只许一套名册。判据 = 会话 cwd 落在监察员工作区
// （dsh-arbiter 的 workspaceDir，或它的默认工作区）。命中就整条跳过；普通目录会话行为不变。
test('名册互斥：cwd 在监察员工作区 ⇒ 本插件一条 context 都不装', async () => {
  await withPlugin(
    async (harness) => {
      const rows = [{ id: 'lead', name: 'lead', role: 'lead', status: 'running' }]
      const arbiterLead = rosterUp(harness, 'lead', rows)
      arbiterLead.agent.session = {
        id: 'session-insp',
        header: { cwd: path.join(defaultArbiterDir(), 'nested'), agentPreset: 'arbiter' },
      }
      await harness.emit('agent/created', { agent: arbiterLead.agent })
      await flush()
      assert.equal(arbiterLead.contexts.length, 0, '监察员工作区的名册归副本插件，原件不许插一手')

      const normalLead = rosterUp(harness, 'lead', rows)
      normalLead.agent.session = { id: 'session-normal', header: { cwd: path.join(os.homedir(), 'Desktop', 'dsh') } }
      await harness.emit('agent/created', { agent: normalLead.agent })
      await flush()
      assert.equal(normalLead.contexts.length, 1, '普通会话照旧有名册')
      assert.equal(normalLead.contexts[0].name, 'agent-team-roles:roster')
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )
})

test('名册互斥：/dsh-arbiter/state 读不到时，仍默认排除 dsh-arbiter 的默认工作区', async () => {
  await withPlugin(
    async (harness) => {
      const rows = [{ id: 'lead', name: 'lead', role: 'lead', status: 'running' }]
      const inDefault = rosterUp(harness, 'lead', rows)
      inDefault.agent.session = { id: 'session-default', header: { cwd: defaultArbiterDir() } }
      await harness.emit('agent/created', { agent: inDefault.agent })
      await flush()
      assert.equal(inDefault.contexts.length, 0, '读不到接口也要排除默认工作区，防冲突')

      const outside = rosterUp(harness, 'lead', rows)
      outside.agent.session = { id: 'session-outside', header: { cwd: path.join(os.homedir(), 'Desktop', 'dsh') } }
      await harness.emit('agent/created', { agent: outside.agent })
      await flush()
      assert.equal(outside.contexts.length, 1, '普通目录照旧装')
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true, arbiterWorkspaceDir: null },
  )
})

test('名册互斥：用户改过工作区时以 workspaceDir 为准', async () => {
  const custom = path.join(os.tmpdir(), 'custom-arbiter-workspace')
  await withPlugin(
    async (harness) => {
      const rows = [{ id: 'lead', name: 'lead', role: 'lead', status: 'running' }]
      const lead = rosterUp(harness, 'lead', rows)
      lead.agent.session = { id: 'session-custom', header: { cwd: custom } }
      await harness.emit('agent/created', { agent: lead.agent })
      await flush()
      assert.equal(lead.contexts.length, 0)
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true, arbiterWorkspaceDir: custom },
  )
})

//#endregion
