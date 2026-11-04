/**
 * 上限与平台门（§7 F1 / F2 / F3）
 *
 * 批次 F4：从 tests/plugin.test.mjs 拆分而来。test() 回调体逐字未改，只有两类机械调整：
 * import 来源换成本目录的相对路径；测试体里 `new URL('../lib/…')` 加深一层为 `'../../lib/…'`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { apply } from '../../lib/index.js'
import { DEFAULT_MODE, resolveGate } from '../../lib/template.js'
import { createHarness, call, withPlugin } from '../support/harness.mjs'
import path from 'node:path'
import { withHome, fakeTools, COMMAND_URL, BASH_DISABLED_ON, expectedBashDisabled } from '../support/plugin-fixtures.mjs'

test('§7 F1 the tool gateway hands its deny list to tools.restrict()', () => {
  const restrictCalls = []
  const harness = createHarness({ tools: fakeTools(['list_agents', 'pwsh', 'run_code'], restrictCalls) })

  // 直接走 `apply()` 的网关分支：`gateConfig()` 一见到 `toolGate` 就只装这个
  // 网关并 return（`lib/host/config.js:104-129`），所以不需要角色目录、也不落任何文件。
  apply(harness.ctx, { toolGate: { deny: ['list_agents', 'ghost-tool', 'run_code'] } })

  // `ghost-tool` 现在没注册、`run_code` 是 registry 拒绝隐藏的那一个
  // （`lib/host/gate.js:140`）——两个都不该出现在 deny 里。
  assert.deepEqual(restrictCalls.map((call) => call.deny), [['list_agents']])
  assert.equal(restrictCalls[0].disposed, false)

  // 卸载时要把 registry 还给我们的 disposer 真的调一次（`lib/host/gate.js:160-162`）。
  assert.equal(harness.effects.length, 1)
  harness.effects[0].dispose()
  assert.equal(restrictCalls[0].disposed, true)
})

test('§7 F1 the MCP gateway expands a server name into tool names for restrict()', () => {
  const restrictCalls = []
  const harness = createHarness({
    tools: fakeTools(
      ['mcp__github__create_issue', 'mcp__github__list_issues', 'mcp__context7__query-docs', 'list_agents'],
      restrictCalls,
    ),
  })

  // 用户填的是**服务名**（`github`），进 registry 的必须是
  // `mcp__github__` 前缀下的确切工具名（`lib/host/gate.js:65`）。
  apply(harness.ctx, { mcpGate: { deny: ['github', 'ghost-server'] } })

  assert.deepEqual(restrictCalls.map((call) => call.deny), [
    ['mcp__github__create_issue', 'mcp__github__list_issues'],
  ])
})
//#endregion

//#region §7 F3 — 平台门的期望值写死，并且逐平台钉住

test('§7 F3 the platform gate resolves per platform, not per host', async () => {
  const snapshot = JSON.parse(
    await readFile(new URL(`../fixtures/presets/${DEFAULT_MODE}.plugins.json`, import.meta.url), 'utf8'),
  )
  const bash = snapshot.plugins.find((row) => row.id === 'tool-bash')
  const pwsh = snapshot.plugins.find((row) => row.id === 'tool-pwsh')

  // 直接读 shipped 快照里的门，在多个平台上各钉一次：旧写法只在本机平台上比较，
  // 门写反、或者写成 `!== '/linux'` 这类「本机仍然对」的错，都看不见。
  assert.equal(resolveGate(bash.disabled, 'win32'), true)
  assert.equal(resolveGate(bash.disabled, 'linux'), false)
  assert.equal(resolveGate(bash.disabled, 'darwin'), false)
  assert.equal(resolveGate(pwsh.disabled, 'win32'), false)
  assert.equal(resolveGate(pwsh.disabled, 'linux'), true)

  // 快照必须和 BASH_DISABLED_ON 这张「部署事实」表一致，否则两处会各说各话。
  assert.equal(resolveGate(bash.disabled, 'win32'), BASH_DISABLED_ON.win32)
  assert.equal(resolveGate(bash.disabled, 'linux'), BASH_DISABLED_ON.linux)
  assert.equal(resolveGate(bash.disabled, 'darwin'), BASH_DISABLED_ON.darwin)

  // 本机渲染出来的值也走同一张表。
  assert.equal(expectedBashDisabled(), BASH_DISABLED_ON[process.platform])
})
//#endregion

//#region §7 F2 — 1 MB 请求体上限（`BODY_LIMIT`）

test('§7 F2 a request body over the 1 MB cap is refused with 413 and changes nothing', async () => {
  await withHome(async (home) => {
    await withPlugin(
      async ({ routes }, dir) => {
        const created = await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Big' })
        assert.equal(created.status, 200)

        // 整个目录的字节快照：不假设索引文件叫什么，也不假设一次 create-role
        // 会写出哪几个文件 —— `store.upsert()`（`lib/roleStore.js`）只写
        // `<dir>/<id>/role.json`，索引 `roles.json` 走的是另一条路径。
        const snapshot = async () => {
          /** @type {Record<string, string>} */
          const files = {}
          for (const name of (await readdir(dir, { recursive: true })).sort()) {
            const full = path.join(dir, name)
            if ((await stat(full)).isDirectory()) continue
            files[name] = (await readFile(full)).toString('base64')
          }
          return files
        }

        const before = await snapshot()
        assert.ok(Object.keys(before).length > 0, '先确认真的落了盘，否则「没改盘」是空断言')

        // 超过 `BODY_LIMIT`（`lib/host/http.js:12` = 1_000_000 字节）一个字节：
        // `readJson()` 在拼 body 的过程中就拒绝（`lib/host/http.js:26`），走不到
        // `JSON.parse`，更走不到 `mutate()` —— 所以盘上一个字节都不该动。
        const response = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-switches',
          id: 'team-big',
          rows: { persona: false },
          filler: 'x'.repeat(1_000_001),
        })

        assert.equal(response.json.error, '请求体过大')
        assert.equal(response.status, 413)
        assert.deepEqual(await snapshot(), before)
      },
      undefined,
      { home },
    )
  })
})
//#endregion

