// 行数已经审批
/** /state 健康、MCP 面板与工具面板。
 * 从 tests/plugin.test.mjs 拆分而来（超 400 行红线），测试体只做了 import 路径加深一层。 */
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

// 插件没注册过的预设不是我们该报告的，读它的 roster 会让每次 /state 都把 Loader 拖回来。
      registryState.records.push({ id: 'standard' })
      assert.deepEqual((await call(routes, STATE_URL)).json.registry, [{ id: 'team-reviewer' }])

// 编辑角色会重新挂载它，这一次注册表判它 broken。
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
// 诊断读取挪到重建之后、出了响应路径；它仍要冒出来 —— 插件读不到 roster 正是角色可能静默坏掉的时候。
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
// 角色本身照旧提供：roster 只是可选附加。
      assert.equal(state.json.roles.length, 1)
// 健康状态未知，不是「从没注册过」—— 角色仍旧是我们的。
      assert.deepEqual(state.json.registry, [{ id: 'team-reviewer' }])
    },
    REVIEWER,
  )
})

/** 面板里背景那行要写清行从哪来，字段名必须与 lib/live-template.js 造的 source 块一致。
 * generatedAt 与 deployment 不在快照里，读它们会给 UI 两个永久的 null 冒充真来源。 */

test('state names the deployment preset the rows came from, and no file', async () => {
  await withPlugin(async ({ routes }) => {
    const { template } = (await call(routes, STATE_URL)).json
    assert.equal(template.presetId, 'standard')
    assert.equal(template.rowCount, 19)
// 行是运行时从 Loader 读的，没有文件名与抽取时间可写。
// 两者在载荷里保持 null，这样 UI 不用猜字段是缺失还是空。
    assert.equal(template.file, null)
    assert.equal(template.extractedAt, null)
    assert.equal(template.deployment, undefined)
    assert.equal(template.generatedAt, undefined)
  }, REVIEWER)
})

//#region MCP switches, the workdir panel and the role's own AGENTS.md (R2.3 / R2.4 / )

/** 一个只放一份连接器存储文件的 dsh home：MCP 面板读的是**部署的**文件，
 * 想翻开关又不改机器真实的 ~/.dsh/storages/mcp_connector.json 就只能这么造。
 * 文档是连接器的真实形状，裁到读取器碰的字段。 */

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
// 插件工具门是第二个能力块。
          toolGate: { deny: [] },
// 再也没有 loop 块：角色带不了 agent-loop 行，这里没什么可记的。
        })
// 什么都没关就不出现网关行 …… 不碰面板的角色组合与从前一模一样。
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
// 写在预设重建之前就答了；网关行由后台重建物化，下面的 call 会等它。
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
// 这一行是**加到**角色行里的，模板行不动。
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

//#region — 插件可见性（第二个网关：per-role 工具遮蔽）

/** 一个像 tools.schemas() 会投影出来的根注册表：含 MCP 工具与 run_code。
 * 假服务实现了 restrict() 并记录每次调用与释放 —— 少了它，所有调用方都停在
 * typeof tools.restrict !== 'function' 的守卫上，真正遮工具的那半条路没有覆盖。 */

test('the plugin panel lists the root tools minus run_code and the MCP tools', async () => {
  await withHome(async (home) => {
    const long = 'x'.repeat(200)
    await withPlugin(
      async ({ routes }) => {
        const state = await call(routes, STATE_URL)
        assert.equal(state.json.toolGate.error, null)
// 按名字排序；run_code（注册表拒绝它）与所有 mcp__… 名字（归 MCP 面板按 server 管）都不在。
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

test('a tool switch materializes the second gateway row', async () => {
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
// 写在重建前就答了；下面那行由后台那趟物化，call 会等它。
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
// MCP 门是**另一行**，仍不出现：两个开关，两行。
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

test('set-switches refuses a tool the deployment does not register', async () => {
  await withHome(async (home) => {
    await withPlugin(
      async ({ routes }) => {
        await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })

// run_code 在面板列表里故意读成不存在，所以请求它得到与拼错一样的拒绝。
        const bogus = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-switches',
          id: 'team-reviewer',
          tools: { run_code: false, ego_hover: false },
        })
        assert.equal(bogus.status, 400)
        assert.equal(bogus.json.error, '这个部署里没有工具：run_code、ego_hover')

// 非法名字与非布尔值在触及注册表之前就被拒。
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

// 这些拒绝一个字都没写。
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

test('an unreadable tool registry is reported, not treated as a refusal', async () => {
  await withHome(async (home) => {
    await withPlugin(
      async ({ routes }) => {
        await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })

// 根本没有 tools 服务（默认 harness）：面板说明为什么是空的 ……
        const state = await call(routes, STATE_URL)
        assert.equal(state.json.toolGate.error, 'tools 服务不可用，读不到工具清单')
        assert.deepEqual(state.json.toolGate.tools, [])

// …… 且开关照旧工作，因为注册表缺失不能让面板变只读（存的名单在挂载时才求交）。
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
// 报错会列出**真的**有什么 —— 按部署校验而不是按存下来的清单，这就是要点。
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
// 错误是 null 不是字符串：什么都没连过。
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
