/** 角色目录与增删改（create / rename / reset / delete / mode）。
 * 从 tests/plugin.test.mjs 拆分而来（超 400 行红线），测试体只做了 import 路径加深一层。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { call, withPlugin } from '../support/harness.mjs'
import path from 'node:path'
import { REVIEWER, withHome, definitionOf, STATE_URL, COMMAND_URL } from '../support/plugin-fixtures.mjs'

test('a new role works in its own directory, and its AGENTS.md is wired to it', async () => {
  await withPlugin(async ({ registered, routes }) => {
    await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })

    const before = await call(routes, STATE_URL)

// loop 行已从 /state 去掉，替代它的是关于**部署自己**那份 agent-loop 声明的只读说明。
    assert.equal(before.json.loop, undefined)
    const standard = before.json.workdir.standard
    assert.ok(standard, 'the bundled snapshot should carry the deployment agent-loop row')
    assert.equal(typeof standard.config.maxParallelToolCalls, 'number')
    assert.match(before.json.workdir.source.patch, /cordis\.patch\.yml$/)

// 建角色就是建目录，目录里的规则文件自动接上，用户不用输路径。
    const created = before.json.roles.find((role) => role.id === 'team-reviewer')
    assert.match(path.basename(created.dir), /^team-reviewer$/)
    assert.equal(created.agentsMdFile, path.join(created.dir, 'AGENTS.md'))
    assert.equal(created.agentsMd.dshHome, created.dir)
    assert.equal(created.agentsMd.linked, true)
    assert.equal(created.capabilities.loop, undefined)

    const plugins = definitionOf(registered, 'team-reviewer').plugins
// 角色的规则文件不是新行：它是快照自带的 agent-instructions 行加上一个键。
    assert.equal(plugins.find((row) => row.id === 'agent-instructions').config.dshHome, created.dir)
// ……而且任何角色都不能带 agent-loop 行。
    assert.equal(plugins.some((row) => row.id === 'agent-team-loop' || row.id === 'agent-loop'), false)
  })
})

test('the old set-loop action is gone, so a stale client gets a loud error', async () => {
// 动作是删掉而不是留成 no-op：改之前就加载着的页签不能看起来像保存了目录。
  await withPlugin(async ({ routes }) => {
    const stale = await call(routes, COMMAND_URL, 'POST', {
      action: 'set-loop',
      id: 'team-reviewer',
      cwd: 'C:\\work',
    })
    assert.equal(stale.status, 400)
    assert.match(stale.json.error, /未知操作：set-loop/)
  }, REVIEWER)
})

test('a role file with a loop block is normalized instead of round-tripped', async () => {
  const stored = {
    roles: [
      {
        id: 'team-reviewer',
        name: 'Reviewer',
        order: 10,
        overrides: {},
        capabilities: { mcp: { deny: ['github'] }, loop: { enabled: true, cwd: null, maxParallelToolCalls: 4 } },
        createdAt: '2026-09-27T00:00:00.000Z',
        updatedAt: '2026-09-27T00:00:00.000Z',
      },
    ],
  }
  await withHome(async (home) => {
    await withPlugin(
      async ({ registered, routes }, dir) => {
        const reloaded = await call(routes, COMMAND_URL, 'POST', { action: 'reload' })
        assert.equal(reloaded.status, 200)
// MCP 决定存活；退役的 loop 块没有回来。
        assert.deepEqual(reloaded.json.state.roles[0].capabilities, {
          mcp: { deny: ['github'] },
// 早于插件门的角色文件会补上空的块。
          toolGate: { deny: [] },
        })
        assert.equal(reloaded.json.state.roles[0].agentsMdFile, path.join(dir, 'team-reviewer', 'AGENTS.md'))
        assert.equal(reloaded.json.state.roles[0].agentsMd.linked, true)

        const plugins = definitionOf(registered, 'team-reviewer').plugins
        assert.deepEqual(
          plugins.filter((row) => row.id === 'agent-team-mcp-gate').map((row) => row.id),
          ['agent-team-mcp-gate'],
        )
        assert.equal(plugins.some((row) => row.id === 'agent-team-loop' || row.id === 'agent-loop'), false)
      },
      stored,
      { home },
    )
  })
})

test('capabilities and overrides are two independent stores on the same role', async () => {
  const stored = {
    roles: [
      {
        id: 'team-reviewer',
        name: 'Reviewer',
        order: 10,
        overrides: { 'tool-web': { config: { fetch: false } } },
// loop 块是老角色文件的样子：存储载入时退役它，这条用例不测那个。
        capabilities: { mcp: { deny: ['github'] }, loop: { enabled: false, cwd: null, maxParallelToolCalls: null } },
        createdAt: '2026-09-27T00:00:00.000Z',
        updatedAt: '2026-09-27T00:00:00.000Z',
      },
    ],
  }
  await withHome(async (home) => {
    await withPlugin(
      async ({ registered, routes }) => {
// 翻能力必须让 override 表逐字节不变。
        const denied = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-mcp',
          id: 'team-reviewer',
          server: 'agentmemhub',
          enabled: false,
        })
        assert.equal(denied.status, 200)
        assert.deepEqual(denied.json.state.roles[0].overrides, { 'tool-web': { config: { fetch: false } } })
        assert.deepEqual(denied.json.state.roles[0].capabilities.mcp.deny, ['agentmemhub', 'github'])

// ……翻 override 也不能动能力。
        const flipped = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-override',
          id: 'team-reviewer',
          row: 'tool-web',
          disabled: true,
        })
        assert.equal(flipped.status, 200)
        assert.deepEqual(flipped.json.state.roles[0].capabilities.mcp.deny, ['agentmemhub', 'github'])
        assert.deepEqual(flipped.json.state.roles[0].overrides, { 'tool-web': { disabled: true, config: { fetch: false } } })

// 两者都出现在挂载的预设里，各走各自通道。
        const plugins = definitionOf(registered, 'team-reviewer').plugins
        assert.deepEqual(
          plugins.find((row) => row.id === 'agent-team-mcp-gate').config,
          { mcpGate: { deny: ['agentmemhub', 'github'] } },
        )
        const web = plugins.find((row) => row.id === 'tool-web')
        assert.equal(web.disabled, true)
// 挂载的行带着模板 config 与 override 合并。
        assert.equal(web.config.fetch, false)
      },
      stored,
      { home },
    )
  })
})

test('the context switch is an override on the row the template already ships', async () => {
  const stored = {
    roles: [
      {
        id: 'team-reviewer',
        name: 'Reviewer',
        order: 10,
        overrides: {},
        createdAt: '2026-09-27T00:00:00.000Z',
        updatedAt: '2026-09-27T00:00:00.000Z',
      },
    ],
  }
  await withHome(async (home) => {
    await withPlugin(
      async ({ registered, routes }) => {
        /** The model-facing delegation tools live inside the `delegation` group. */
        const subagentRow = () =>
          definitionOf(registered, 'team-reviewer')
            .plugins.find((row) => row.id === 'delegation')
            .config.find((row) => row.id === 'tool-subagent')

        // The template's own value: a fresh child with zero parent context.
        assert.equal(subagentRow().config.provider, 'spawn')
        assert.equal(subagentRow().config.toolName, 'subagent')

        // 「上下文是否继承主会话」 (R8, user / m07236) is one key on that row.
        const on = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-override',
          id: 'team-reviewer',
          row: 'tool-subagent',
          config: { provider: 'fork' },
        })
        assert.equal(on.status, 200)
        assert.deepEqual(on.json.state.roles[0].overrides, { 'tool-subagent': { config: { provider: 'fork' } } })

        const described = on.json.state.roles[0].rows.find((item) => item.id === 'tool-subagent')
        assert.equal(described.path, 'delegation/tool-subagent')
        assert.equal(described.config.provider, 'fork')
        assert.equal(described.templateConfig.provider, 'spawn')
        assert.equal(subagentRow().config.provider, 'fork')
        // Nothing was added: the group keeps its rows and the tool keeps its name.
        assert.equal(subagentRow().config.toolName, 'subagent')

        // Off is `clearConfig`, so the entry disappears and the template wins again.
        const off = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-override',
          id: 'team-reviewer',
          row: 'tool-subagent',
          clearConfig: ['provider'],
        })
        assert.equal(off.status, 200)
        assert.deepEqual(off.json.state.roles[0].overrides, {})
        assert.equal(subagentRow().config.provider, 'spawn')
      },
      stored,
      { home },
    )
  })
})
