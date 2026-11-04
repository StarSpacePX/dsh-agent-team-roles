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


//#region §5.32 模式（m07307 / m07345：「角色详情里加一个四选一」）

test('a role composes the mode it is set to, and the reset key returns it to standard', async () => {
  await withHome(async (home) => {
    await writeFile(path.join(home, 'AGENTS.md'), '# main session rules\n', 'utf8')

    await withPlugin(
      async ({ registered, routes }) => {
        const created = await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })
        assert.equal(created.status, 200)
        const id = created.json.id
        const role = created.json.state.roles.find((item) => item.id === id)

        // A new role starts on 标准模式 — 「默认使用标准模式」 (m07307).
        assert.equal(role.mode, 'standard')
        assert.equal(role.modeLabel, '标准模式')
        assert.equal(role.agentsMd.hasRow, true)

        // The four choices come from `/state`, so the client never hardcodes the
        // deployment's presets — its own list would drift on an upgrade.
        // 用户 m07126/m07129：角色自己那份复制品预设也要列出来（`source: 'role'`），
        // 并且是面板默认选中的那个（`role.presetId` = 它自己的 id）。
        assert.deepEqual(
          created.json.state.modes.map((mode) => [mode.id, mode.label, mode.available, mode.source]),
          [
            ['standard', '标准模式', true, 'live'],
            ['ptc', 'PTC 模式', true, 'live'],
            ['minimal', '极简模式', true, 'live'],
            ['cordis', '创造模式', true, 'live'],
            [id, 'Reviewer（角色预设）', true, 'role'],
          ],
        )
        assert.equal(role.presetId, id)
        const standardRows = role.rows.length
        assert.equal(definitionOf(registered, id).plugins.length, 19)

        // 标准模式 → PTC 模式: the whole row table is recomposed, and the row the
        // deployment only ships in `ptc` appears — in the UI *and* in the preset
        // the registry would mount.
        const toPtc = await call(routes, COMMAND_URL, 'POST', { action: 'set-mode', id, mode: 'ptc' })
        assert.equal(toPtc.status, 200)
        const ptc = toPtc.json.state.roles.find((item) => item.id === id)
        assert.equal(ptc.mode, 'ptc')
        assert.equal(ptc.modeLabel, 'PTC 模式')
        assert.equal(ptc.rows.some((row) => row.id === 'tool-presentation'), true)
        assert.equal(role.rows.some((row) => row.id === 'tool-presentation'), false)
        assert.equal(definitionOf(registered, id).plugins.some((row) => row.id === 'tool-presentation'), true)

        // ... and 极简模式, where it only ships `persona` + a terminal group. The
        // honest caveats are reported rather than papered over: no
        // `agent-instructions` row (so this role's own AGENTS.md is not read) and
        // no delegation row (so R8's switch has nothing to move).
        const toMinimal = await call(routes, COMMAND_URL, 'POST', { action: 'set-mode', id, mode: 'minimal' })
        assert.equal(toMinimal.status, 200)
        const minimal = toMinimal.json.state.roles.find((item) => item.id === id)
        // The panel's row table is flat: the group itself, then its children, each
        // carrying the `parent` path. `minimal` is `persona` + one terminal group.
        assert.deepEqual(
          minimal.rows.filter((row) => row.parent === null).map((row) => row.id),
          ['persona', 'persistent-shell'],
        )
        assert.deepEqual(
          minimal.rows.filter((row) => row.parent === 'persistent-shell').map((row) => row.id),
          ['pty', 'terminal-bash', 'persistent-bash', 'terminal-pwsh', 'persistent-pwsh'],
        )
        assert.equal(minimal.agentsMd.hasRow, false)
        assert.equal(minimal.rows.some((row) => row.id === 'tool-subagent'), false)
        assert.equal(
          definitionOf(registered, id).plugins.some((row) => row.id === 'agent-instructions'),
          false,
        )

        // An unknown mode is refused instead of quietly reshaping the role into
        // 标准模式 — the coercion in `normalizeRole` is for files, not for clicks.
        const bad = await call(routes, COMMAND_URL, 'POST', { action: 'set-mode', id, mode: 'spawn' })
        assert.equal(bad.status, 400)
        assert.match(bad.json.error, /未知的模式/)

        // Layer 2 of §5.29's restore keys: the mode goes back to the default too,
        // which is what the button's title promises.
        const reset = await call(routes, COMMAND_URL, 'POST', { action: 'reset-role', id })
        assert.equal(reset.status, 200)
        const after = reset.json.state.roles.find((item) => item.id === id)
        assert.equal(after.mode, 'standard')
        assert.equal(after.rows.length, standardRows)
      },
      undefined,
      { home },
    )
  })
})

test('a role file with no mode still loads, as standard', async () => {
  // Exactly the document a pre-§5.32 profile has on disk: no `mode` anywhere.
  // It must keep working, and it must land on the default the user named.
  await withPlugin(
    async ({ registered, routes }) => {
      const state = await call(routes, STATE_URL)
      const role = state.json.roles.find((item) => item.id === 'team-reviewer')
      assert.equal(role.mode, 'standard')
      assert.equal(role.modeLabel, '标准模式')
      assert.equal(role.modeAvailable, true)
      // The rows are the standard snapshot's — an old file is not left with an
      // empty table, and the preset the registry holds is complete.
      assert.ok(role.rows.length > 0)
      assert.equal(definitionOf(registered, 'team-reviewer').plugins.length, 19)
    },
    {
      version: 1,
      roles: [{ id: 'team-reviewer', name: 'Reviewer', description: '', order: 10, overrides: {} }],
    },
  )
})

// §5.33 — 「启用智能体团队」. The switch belongs to the deployment, so the tests
// stand in for it: a fake `pluginManager` that remembers the profile's selection.

/**
 * The smallest thing that behaves like the profile's bundle manager.
 *
 * @param {{ installed?: boolean, enabled?: boolean, removable?: boolean, readOnlyReason?: string, application?: string, error?: object, warnings?: string[] }} [row]
 */
