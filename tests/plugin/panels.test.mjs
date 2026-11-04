// 行数已经审批
/**
 * /state 健康、MCP 面板与工具面板（§5.55）
 *
 * 批次 F4：从 tests/plugin.test.mjs 拆分而来。test() 回调体逐字未改，只有两类机械调整：
 * import 来源换成本目录的相对路径；测试体里 `new URL('../lib/…')` 加深一层为 `'../../lib/…'`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { call, withPlugin } from '../support/harness.mjs'
import os from 'node:os'
import path from 'node:path'
import { REVIEWER, withHome, definitionOf, fakeTools, STATE_URL, COMMAND_URL } from '../support/plugin-fixtures.mjs'

test('state reports the mount health of our roles, including a broken preset', async () => {
  await withPlugin(
    async ({ routes, registryState }) => {
      assert.deepEqual((await call(routes, STATE_URL)).json.registry, [{ id: 'team-reviewer' }])

      // A preset the plugin never registered is not ours to report, and reading the
      // roster for it would drag the Loader back into every `/state` call.
      registryState.records.push({ id: 'standard' })
      assert.deepEqual((await call(routes, STATE_URL)).json.registry, [{ id: 'team-reviewer' }])

      // Editing the role re-mounts it, and this time the registry calls it broken.
      registryState.records.push({ id: 'team-reviewer', broken: "row 'tool-nope' is not declared" })
      const write = await call(routes, COMMAND_URL, 'POST', {
        action: 'update-role',
        id: 'team-reviewer',
        name: '审阅者',
      })
      assert.equal(write.status, 200)

      const state = await call(routes, STATE_URL)
      assert.deepEqual(state.json.registry, [
        { id: 'team-reviewer', broken: "row 'tool-nope' is not declared" },
      ])
      assert.equal(state.json.registryError, null)
    },
    REVIEWER,
  )
})

test('a failing roster read is reported instead of failing the state call', async () => {
  await withPlugin(
    async ({ routes, registryState }) => {
      // §5.54 — the diagnosis read now happens after a rebuild, off the response
      // path. It still has to surface, because a roster the plugin cannot read is
      // exactly when a role may be silently broken.
      registryState.failure = 'registry offline'
      const write = await call(routes, COMMAND_URL, 'POST', {
        action: 'update-role',
        id: 'team-reviewer',
        name: '审阅者',
      })
      assert.equal(write.status, 200)

      const state = await call(routes, STATE_URL)
      assert.equal(state.status, 200)
      assert.equal(state.json.registryError, 'registry offline')
      // The roles themselves are still served: the roster is an optional extra.
      assert.equal(state.json.roles.length, 1)
      // Health is unknown, not "never registered" — the role is still ours.
      assert.deepEqual(state.json.registry, [{ id: 'team-reviewer' }])
    },
    REVIEWER,
  )
})

/**
 * The background line in the panel names where the rows came from, so the field
 * names have to match the `source` block `lib/live-template.js` builds exactly. `generatedAt` and
 * `deployment` are not in the snapshot, so reading them would hand the
 * UI two permanent `null`s that looked like real provenance.
 */

test('state names the deployment preset the rows came from, and no file', async () => {
  await withPlugin(async ({ routes }) => {
    const { template } = (await call(routes, STATE_URL)).json
    assert.equal(template.presetId, 'standard')
    assert.equal(template.rowCount, 19)
    // §5.62 — the rows are read live out of the Loader, so there is no file and
    // no extraction time to name. Both stay in the payload as `null` so the UI
    // never has to guess whether the field is missing or empty.
    assert.equal(template.file, null)
    assert.equal(template.extractedAt, null)
    assert.equal(template.deployment, undefined)
    assert.equal(template.generatedAt, undefined)
  }, REVIEWER)
})

//#region MCP switches, the workdir panel and the role's own AGENTS.md (R2.3 / R2.4 / §5.30)

/**
 * A dsh home holding one connector storage file. The MCP panel reads the
 * *deployment's* file, so a test that wanted to flip a switch would otherwise
 * have to edit the machine's real `~/.dsh/storages/mcp_connector.json`.
 *
 * The document is the connector's real shape, trimmed to the fields the reader
 * touches.
 */

test('the MCP panel lists the deployment servers and a switch materializes one gateway row', async () => {
  await withHome(async (home) => {
    await withPlugin(
      async ({ registered, routes }) => {
        await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })

        const state = await call(routes, STATE_URL)
        assert.equal(state.json.mcp.error, null)
        assert.deepEqual(
          state.json.mcp.services.map((server) => server.serverName),
          ['agentmemhub', 'github'],
        )
        const fresh = state.json.roles.find((role) => role.id === 'team-reviewer')
        assert.deepEqual(fresh.capabilities, {
          mcp: { deny: [] },
          // §5.55: the plugin-tool gate is the second capability block.
          toolGate: { deny: [] },
          // §5.30: no `loop` block at all any more — a role cannot carry an
          // `agent-loop` row, so there is nothing to remember here.
        })
        // Nothing switched off means no gateway row at all … a role that never
        // touches the panel composes exactly as it did before.
        assert.equal(
          definitionOf(registered, 'team-reviewer').plugins.some((row) => row.id === 'agent-team-mcp-gate'),
          false,
        )
        assert.equal(
          definitionOf(registered, 'team-reviewer').plugins.some((row) => row.id === 'agent-team-tool-gate'),
          false,
        )

        const off = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-mcp',
          id: 'team-reviewer',
          server: 'github',
          enabled: false,
        })
        assert.equal(off.status, 200)
        // §5.54 — the write answers before the preset is rebuilt; the gateway row is
        // materialized by the background rebuild, which `call` waits for below.
        assert.deepEqual(off.json.result.applied, [])
        assert.deepEqual(off.json.result.deferred, ['team-reviewer'])
        assert.deepEqual(off.json.state.roles.find((role) => role.id === 'team-reviewer').capabilities.mcp, {
          deny: ['github'],
        })

        const gateway = definitionOf(registered, 'team-reviewer').plugins.filter(
          (row) => row.id === 'agent-team-mcp-gate',
        )
        assert.deepEqual(gateway, [
          {
            id: 'agent-team-mcp-gate',
            name: 'dsh-agent-team-roles',
            config: { mcpGate: { deny: ['github'] } },
          },
        ])
        // The row is *added* to the role's rows; the template rows are untouched.
        assert.equal(
          definitionOf(registered, 'team-reviewer').plugins.find((row) => row.id === 'tool-bash').id,
          'tool-bash',
        )

        const on = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-mcp',
          id: 'team-reviewer',
          server: 'github',
          enabled: true,
        })
        assert.equal(on.status, 200)
        assert.deepEqual(on.json.state.roles.find((role) => role.id === 'team-reviewer').capabilities.mcp, {
          deny: [],
        })
        assert.equal(
          definitionOf(registered, 'team-reviewer').plugins.some((row) => row.id === 'agent-team-mcp-gate'),
          false,
        )
      },
      undefined,
      { home },
    )
  })
})

//#region §5.55 — 插件可见性（第二个网关：per-role 工具遮蔽）

/**
 * A root registry like `tools.schemas()` would project: MCP tools and run_code included.
 *
 * §7 F1 — `restrict()` is part of the real service. Leaving it out meant every
 * caller stopped at the `typeof tools.restrict !== 'function'` guard, so the part
 * of the gateway that actually hides tools had no coverage. The fake now
 * implements it and records each call (and each disposal) for the assertions.
 *
 * @param {(string | { name: string, description?: string })[]} names
 * @param {{ deny: string[], disposed: boolean }[]} restrictCalls
 */

test('§5.55 the plugin panel lists the root tools minus run_code and the MCP tools', async () => {
  await withHome(async (home) => {
    const long = 'x'.repeat(200)
    await withPlugin(
      async ({ routes }) => {
        const state = await call(routes, STATE_URL)
        assert.equal(state.json.toolGate.error, null)
        // Sorted by name; `run_code` (the registry refuses it) and every
        // `mcp__…` name (the MCP panel owns those, by server) are gone.
        assert.deepEqual(state.json.toolGate.tools, [
          { name: 'ego_click', description: `${'x'.repeat(160)}…` },
          { name: 'list_agents', description: 'Ask the team who is around.' },
          { name: 'pwsh', description: '' },
        ])
      },
      undefined,
      { home },
      {
        tools: fakeTools([
          { name: 'pwsh', description: '' },
          { name: 'list_agents', description: 'Ask the team who is around.' },
          { name: 'ego_click', description: long },
          { name: 'run_code', description: 'not restrictable' },
          { name: 'mcp__github__create_issue', description: 'MCP' },
          { name: 'mcp__context7__query-docs', description: 'MCP' },
        ]),
      },
    )
  })
})

test('§5.55 a tool switch materializes the second gateway row', async () => {
  await withHome(async (home) => {
    await withPlugin(
      async ({ registered, routes }) => {
        await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })

        const off = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-switches',
          id: 'team-reviewer',
          tools: { list_agents: false },
        })
        assert.equal(off.status, 200)
        // §5.54 — the write still answers before the rebuild; the row below is
        // materialized by the background pass that `call` waits for.
        assert.deepEqual(off.json.tools, ['list_agents'])
        assert.deepEqual(off.json.result.applied, [])
        assert.deepEqual(off.json.result.deferred, ['team-reviewer'])
        assert.deepEqual(
          off.json.state.roles.find((role) => role.id === 'team-reviewer').capabilities.toolGate,
          { deny: ['list_agents'] },
        )

        assert.deepEqual(
          definitionOf(registered, 'team-reviewer').plugins.filter((row) => row.id === 'agent-team-tool-gate'),
          [
            {
              id: 'agent-team-tool-gate',
              name: 'dsh-agent-team-roles',
              config: { toolGate: { deny: ['list_agents'] } },
            },
          ],
        )
        // The MCP gate is a *separate* row and stays absent: two switches, two rows.
        assert.equal(
          definitionOf(registered, 'team-reviewer').plugins.some((row) => row.id === 'agent-team-mcp-gate'),
          false,
        )

        const on = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-switches',
          id: 'team-reviewer',
          tools: { list_agents: true },
        })
        assert.equal(on.status, 200)
        assert.deepEqual(
          on.json.state.roles.find((role) => role.id === 'team-reviewer').capabilities.toolGate,
          { deny: [] },
        )
        assert.equal(
          definitionOf(registered, 'team-reviewer').plugins.some((row) => row.id === 'agent-team-tool-gate'),
          false,
        )
      },
      undefined,
      { home },
      { tools: fakeTools(['list_agents', 'pwsh']) },
    )
  })
})

test('§5.55 set-switches refuses a tool the deployment does not register', async () => {
  await withHome(async (home) => {
    await withPlugin(
      async ({ routes }) => {
        await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })

        // `run_code` reads as absent from the panel's list on purpose, so asking
        // for it hits the same refusal as a typo would.
        const bogus = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-switches',
          id: 'team-reviewer',
          tools: { run_code: false, ego_hover: false },
        })
        assert.equal(bogus.status, 400)
        assert.equal(bogus.json.error, '这个部署里没有工具：run_code、ego_hover')

        // A malformed name and a non-boolean value are refused before the registry
        // is ever consulted.
        const malformed = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-switches',
          id: 'team-reviewer',
          tools: { 'has space': false },
        })
        assert.equal(malformed.status, 400)
        assert.match(malformed.json.error, /工具名不合法/)

        const notBoolean = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-switches',
          id: 'team-reviewer',
          tools: { list_agents: 'off' },
        })
        assert.equal(notBoolean.status, 400)
        assert.match(notBoolean.json.error, /工具开关必须是布尔值/)

        // None of the refusals wrote anything.
        const state = await call(routes, STATE_URL)
        assert.deepEqual(
          state.json.roles.find((role) => role.id === 'team-reviewer').capabilities.toolGate,
          { deny: [] },
        )
      },
      undefined,
      { home },
      { tools: fakeTools(['list_agents']) },
    )
  })
})

test('§5.55 an unreadable tool registry is reported, not treated as a refusal', async () => {
  await withHome(async (home) => {
    await withPlugin(
      async ({ routes }) => {
        await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })

        // No `tools` service at all (the default harness): the panel says why it
        // is empty …
        const state = await call(routes, STATE_URL)
        assert.equal(state.json.toolGate.error, 'tools 服务不可用，读不到工具清单')
        assert.deepEqual(state.json.toolGate.tools, [])

        // … and the switch still works, because a missing registry must not make
        // the panel read-only (the stored name is intersected at mount time).
        const off = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-switches',
          id: 'team-reviewer',
          tools: { list_agents: false },
        })
        assert.equal(off.status, 200)
        assert.deepEqual(
          off.json.state.roles.find((role) => role.id === 'team-reviewer').capabilities.toolGate,
          { deny: ['list_agents'] },
        )
      },
      undefined,
      { home },
    )
  })
})

//#endregion

test('set-mcp refuses a server the deployment does not have, and a malformed switch', async () => {
  await withHome(async (home) => {
    await withPlugin(
      async ({ routes }) => {
        await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })

        const unknown = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-mcp',
          id: 'team-reviewer',
          server: 'gitlab',
          enabled: false,
        })
        assert.equal(unknown.status, 400)
        assert.match(unknown.json.error, /部署里没有 MCP server「gitlab」/)
        // The error names what *is* available, which is the whole point of
        // validating against the deployment instead of a stored list.
        assert.match(unknown.json.error, /agentmemhub/)

        const badName = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-mcp',
          id: 'team-reviewer',
          server: 'bad name!',
          enabled: false,
        })
        assert.equal(badName.status, 400)
        assert.match(badName.json.error, /名字不合法/)

        const badFlag = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-mcp',
          id: 'team-reviewer',
          server: 'github',
          enabled: 'yes',
        })
        assert.equal(badFlag.status, 400)
        assert.match(badFlag.json.error, /需要 enabled 布尔值/)
      },
      undefined,
      { home },
    )
  })
})

test('a home without a connector storage is an empty panel, not an error', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'team-roles-home-'))
  try {
    await withPlugin(
      async ({ routes }) => {
        const state = await call(routes, STATE_URL)
        assert.equal(state.status, 200)
        assert.deepEqual(state.json.mcp.services, [])
        // `null` error, not a string: nothing was connected yet.
        assert.equal(state.json.mcp.error, null)

        const refused = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-mcp',
          id: 'team-reviewer',
          server: 'github',
          enabled: false,
        })
        assert.equal(refused.status, 400)
        assert.match(refused.json.error, /还没有任何连接/)
      },
      REVIEWER,
      { home },
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

