/** 模式清单（从现有模式加载，不写死）与 set-mode。
 * 从 tests/plugin/team-and-config.test.mjs 拆出（超 400 行红线），用例体逐字未改。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, withPlugin } from '../support/harness.mjs'
import { withHome, definitionOf, fakeLoader, expectedBashDisabled, STATE_URL, COMMAND_URL } from '../support/plugin-fixtures.mjs'

//#region — 模式清单不写死（）

/**
 * A Loader stand-in. `entries()` returns the plugin entries this deployment
 * holds in the shape Cordis hands them over: `options` *is* the parsed row, so
 * `options.config.plugins` is the preset's composition list.
 */

test('the mode list is the deployment roster, not a hardcoded four', async () => {
  const loader = fakeLoader([
    {
      id: 'house-style',
      order: 5,
      plugins: [{ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'live persona' } }],
    },
  ])
  await withHome(async (home) => {
    await withPlugin(
      async ({ routes, registryState }) => {
        registryState.records.push({ id: 'standard', order: 1 })
        registryState.records.push({ id: 'house-style', name: '我的模式', order: 5 })

        const state = await call(routes, STATE_URL)
        assert.deepEqual(
          state.json.modes.map((mode) => mode.id),
          ['standard', 'house-style'],
        )
        const shipped = state.json.modes[0]
        assert.equal(shipped.source, 'live') // §5.62 — read from the Loader, never a copy
        assert.equal(shipped.label, '标准模式') // the roster carries no name for a shipped preset
        assert.equal(shipped.available, true)
        assert.equal(shipped.file, null)

        const live = state.json.modes[1]
        assert.equal(live.source, 'live')
        assert.equal(live.label, '我的模式') // a preset the user made carries its own name
        assert.equal(live.available, true)
        assert.equal(live.file, null) // nothing on disk backs it
        assert.equal(live.rowCount, 1)
      },
      undefined,
      { home },
      { loader },
    )
  })
})

test('a live preset composes a role from its declaration, `!!js` gates included', async () => {
  const loader = fakeLoader([
    {
      id: 'house-style',
      order: 5,
      plugins: [
        { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'live persona' } },
        {
          id: 'tool-bash',
          name: '@deepseek-ai/dsh-tool-bash',
          disabled: { __jsExpr: "process.platform === 'win32'" },
        },
      ],
    },
  ])
  await withHome(async (home) => {
    await withPlugin(
      async ({ routes, registered, registryState }) => {
        registryState.records.push({ id: 'standard', order: 1 })
        registryState.records.push({ id: 'house-style', name: '我的模式', order: 5 })

        const created = await call(routes, COMMAND_URL, 'POST', {
          action: 'create-role',
          id: 'team-live',
          name: 'Live',
          mode: 'house-style',
        })
        assert.equal(created.status, 200)

        // The declaration *is* the composition: both rows, in order, and the
        // Loader's `{ __jsExpr }` gate resolved to a concrete boolean.
        const plugins = definitionOf(registered, 'team-live').plugins
        assert.deepEqual(
          plugins.map((row) => row.id),
          ['persona', 'tool-bash'],
        )
        // — Loader 给的 `{ __jsExpr }` 门由 `resolveGate` 解开；期望值是
        // 常量表，不是把同一个 platform 表达式再抄一遍。
        // 组合行在不该禁用时会删掉 `disabled` 键，缺省按 false 算。
        assert.equal(plugins[1].disabled ?? false, expectedBashDisabled())

        const role = (await call(routes, STATE_URL)).json.roles.find((item) => item.id === 'team-live')
        assert.equal(role.mode, 'house-style')
        assert.equal(role.modeLabel, '我的模式')
        assert.equal(role.modeAvailable, true)
        assert.deepEqual(
          role.rows.map((row) => row.id),
          ['persona', 'tool-bash'],
        )
      },
      undefined,
      { home },
      { loader },
    )
  })
})

test('角色自己那份预设也列在模式列表里（m07129：默认选中的就是它）', async () => {
  await withHome(async (home) => {
    await withPlugin(
      async ({ routes, registryState, registered }) => {
        // The registry holds our own role preset alongside the deployment's.
        registryState.records.push({ id: 'standard', order: 1 })
        registryState.records.push({ id: 'team-architect', name: '架构师', order: 10 })
        assert.equal(
          registered.some((record) => record.id === 'team-architect' && !record.disposed),
          true,
        )

        const state = await call(routes, STATE_URL)
        // 部署预设 + 本插件角色的自有预设：。
        assert.deepEqual(
          state.json.modes.map((mode) => mode.id),
          ['standard', 'team-architect'],
        )
        const own = state.json.modes.find((mode) => mode.id === 'team-architect')
        assert.equal(own.source, 'role')
        assert.equal(own.label, '架构师（角色预设）')
        assert.equal(own.available, true)
        // 面板的默认值取的是它（`role.presetId`），不是模板 `role.mode`。
        const role = state.json.roles.find((item) => item.id === 'team-architect')
        assert.equal(role.presetId, 'team-architect')
        // …but `registry` now reports only the mount health of our own roles
        //  — the deployment's presets are not ours, and reading the roster
        // for them is exactly what made `/state` wait on the Host Loader.
        assert.deepEqual(state.json.registry, [{ id: 'team-architect' }])
      },
      {
        version: 1,
        roles: [{ id: 'team-architect', name: '架构师', description: '', order: 10, overrides: {} }],
      },
      { home },
    )
  })
})

test('set-mode accepts any mode the roster has, and refuses one it does not', async () => {
  const loader = fakeLoader([
    { id: 'house-style', order: 5, plugins: [{ id: 'persona', name: '@deepseek-ai/dsh-persona', config: {} }] },
  ])
  await withHome(async (home) => {
    await withPlugin(
      async ({ routes, registryState }) => {
        registryState.records.push({ id: 'standard', order: 1 })
        registryState.records.push({ id: 'house-style', name: '我的模式', order: 5 })

        const live = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-mode',
          id: 'team-architect',
          mode: 'house-style',
        })
        assert.equal(live.status, 200)
        assert.equal(live.json.mode, 'house-style')

        const typo = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-mode',
          id: 'team-architect',
          mode: 'housestyle',
        })
        assert.equal(typo.status, 400)
        assert.match(typo.json.error, /未知的模式：housestyle（可选 standard \/ house-style）/)

        // A refused switch leaves the role where it was.
        const role = (await call(routes, STATE_URL)).json.roles.find((item) => item.id === 'team-architect')
        assert.equal(role.mode, 'house-style')
      },
      {
        version: 1,
        roles: [{ id: 'team-architect', name: '架构师', description: '', order: 10, overrides: {} }],
      },
      { home },
      { loader },
    )
  })
})

//#region — 成员名册：只有 Lead 知道全部成员（用户 ）

/**
 * The deployment runs every context/section text through `interpolate()` and
 * throws on a `{{name}}` it cannot resolve
 * (`…\dsh-system-prompt\lib\index.js:153-177`). The roster carries
 * `spawn_teammate` free text, so this fake reproduces that pass: text that
 * still looks like a variable must fail here rather than in front of the user's
 * Lead turn.
 *
 * @param {string} text
 * @param {Record<string, string>} [variables]
 * @returns {string}
 */
