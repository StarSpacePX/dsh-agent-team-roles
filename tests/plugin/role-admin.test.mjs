/**
 * 角色目录与增删改（create / rename / reset / delete / mode）
 *
 * 批次 F4：从 tests/plugin.test.mjs 拆分而来。test() 回调体逐字未改，只有两类机械调整：
 * import 来源换成本目录的相对路径；测试体里 `new URL('../lib/…')` 加深一层为 `'../../lib/…'`。
 */
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

    // §5.30: the loop row is gone from `/state`; what replaces it is a read-only
    // note about the *deployment's* own `agent-loop` declaration.
    assert.equal(before.json.loop, undefined)
    const standard = before.json.workdir.standard
    assert.ok(standard, 'the bundled snapshot should carry the deployment agent-loop row')
    assert.equal(typeof standard.config.maxParallelToolCalls, 'number')
    assert.match(before.json.workdir.source.patch, /cordis\.patch\.yml$/)

    // §5.29/§5.30: creating a role creates a directory, and the role's own rules
    // file in it is wired to the role without the user typing a path.
    const created = before.json.roles.find((role) => role.id === 'team-reviewer')
    assert.match(path.basename(created.dir), /^team-reviewer$/)
    assert.equal(created.agentsMdFile, path.join(created.dir, 'AGENTS.md'))
    assert.equal(created.agentsMd.dshHome, created.dir)
    assert.equal(created.agentsMd.linked, true)
    assert.equal(created.capabilities.loop, undefined)

    const plugins = definitionOf(registered, 'team-reviewer').plugins
    // The role's instruction file is not a new row: it is the snapshot's own
    // `agent-instructions` row with one key added.
    assert.equal(plugins.find((row) => row.id === 'agent-instructions').config.dshHome, created.dir)
    // ...and no role may carry an `agent-loop` row, ever (§5.30).
    assert.equal(plugins.some((row) => row.id === 'agent-team-loop' || row.id === 'agent-loop'), false)
  })
})

test('the old set-loop action is gone, so a stale client gets a loud error', async () => {
  // §5.30 removed the action rather than leaving it as a no-op: a browser tab
  // loaded before the change must not silently appear to save a directory.
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
        // The MCP decision survives; the retired `loop` block does not come back.
        assert.deepEqual(reloaded.json.state.roles[0].capabilities, {
          mcp: { deny: ['github'] },
          // §5.55 — a file that predates the plugin gate gains the empty block.
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
        // The `loop` block is what an older role file looks like: the store
        // retires it on load (§5.30), which this test is not about.
        capabilities: { mcp: { deny: ['github'] }, loop: { enabled: false, cwd: null, maxParallelToolCalls: null } },
        createdAt: '2026-09-27T00:00:00.000Z',
        updatedAt: '2026-09-27T00:00:00.000Z',
      },
    ],
  }
  await withHome(async (home) => {
    await withPlugin(
      async ({ registered, routes }) => {
        // Flipping a capability must leave the override table byte-for-byte alone.
        const denied = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-mcp',
          id: 'team-reviewer',
          server: 'agentmemhub',
          enabled: false,
        })
        assert.equal(denied.status, 200)
        assert.deepEqual(denied.json.state.roles[0].overrides, { 'tool-web': { config: { fetch: false } } })
        assert.deepEqual(denied.json.state.roles[0].capabilities.mcp.deny, ['agentmemhub', 'github'])

        // ...and flipping an override must not disturb the capability.
        const flipped = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-override',
          id: 'team-reviewer',
          row: 'tool-web',
          disabled: true,
        })
        assert.equal(flipped.status, 200)
        assert.deepEqual(flipped.json.state.roles[0].capabilities.mcp.deny, ['agentmemhub', 'github'])
        assert.deepEqual(flipped.json.state.roles[0].overrides, { 'tool-web': { disabled: true, config: { fetch: false } } })

        // Both show up in the mounted preset, each through its own channel.
        const plugins = definitionOf(registered, 'team-reviewer').plugins
        assert.deepEqual(
          plugins.find((row) => row.id === 'agent-team-mcp-gate').config,
          { mcpGate: { deny: ['agentmemhub', 'github'] } },
        )
        const web = plugins.find((row) => row.id === 'tool-web')
        assert.equal(web.disabled, true)
        // The mounted row carries the template config merged with the override.
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

        // 「上下文是否继承主会话」 (R8, user m07109 / m07236) is one key on that row.
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
