/** 角色目录与增删改（create / rename / reset / delete / mode）。
 * 从 tests/plugin.test.mjs 拆分而来（超 400 行红线），测试体只做了 import 路径加深一层。 */
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

// 新角色从标准模式起步。
        assert.equal(role.mode, 'standard')
        assert.equal(role.modeLabel, '标准模式')
        assert.equal(role.agentsMd.hasRow, true)

// 四个候选项来自 /state，客户端从不硬编码部署的预设 —— 自己的列表会在升级时漂移。
// 角色自己那份复制品预设也要列出来（source: 'role'），并且是面板默认选中的那个（role.presetId）。
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

// 标准模式 → PTC 模式：整张行表重组，部署只在 ptc 里发的行出现 —— UI 与注册表要挂的预设里都有。
        const toPtc = await call(routes, COMMAND_URL, 'POST', { action: 'set-mode', id, mode: 'ptc' })
        assert.equal(toPtc.status, 200)
        const ptc = toPtc.json.state.roles.find((item) => item.id === id)
        assert.equal(ptc.mode, 'ptc')
        assert.equal(ptc.modeLabel, 'PTC 模式')
        assert.equal(ptc.rows.some((row) => row.id === 'tool-presentation'), true)
        assert.equal(role.rows.some((row) => row.id === 'tool-presentation'), false)
        assert.equal(definitionOf(registered, id).plugins.some((row) => row.id === 'tool-presentation'), true)

// ……以及极简模式（只发 persona + 一个 terminal 组）。缺项如实报告而不是粉饰：
// 没有 agent-instructions 行（角色自己的 AGENTS.md 不会被读），也没有 delegation 行（继承开关无处可动）。
        const toMinimal = await call(routes, COMMAND_URL, 'POST', { action: 'set-mode', id, mode: 'minimal' })
        assert.equal(toMinimal.status, 200)
        const minimal = toMinimal.json.state.roles.find((item) => item.id === id)
// 面板的行表是平的：分组本身、然后它的子行，各带 parent 路径。minimal 是 persona + 一个 terminal 组。
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

// 不认识的模式直接拒，不悄悄把角色改成标准模式 —— normalizeRole 的纠正是给文件的，不是给点击的。
        const bad = await call(routes, COMMAND_URL, 'POST', { action: 'set-mode', id, mode: 'spawn' })
        assert.equal(bad.status, 400)
        assert.match(bad.json.error, /未知的模式/)

// 还原键的第二层：模式也回到默认，这才是按钮标题承诺的。
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
// 就是还没有四种模式时磁盘上的文档：哪儿都没有 mode。它必须能继续用，并落到用户点名的默认。
  await withPlugin(
    async ({ registered, routes }) => {
      const state = await call(routes, STATE_URL)
      const role = state.json.roles.find((item) => item.id === 'team-reviewer')
      assert.equal(role.mode, 'standard')
      assert.equal(role.modeLabel, '标准模式')
      assert.equal(role.modeAvailable, true)
// 行来自标准快照 —— 老文件不会被留成空表，注册表持有的预设是完整的。
      assert.ok(role.rows.length > 0)
      assert.equal(definitionOf(registered, 'team-reviewer').plugins.length, 19)
    },
    {
      version: 1,
      roles: [{ id: 'team-reviewer', name: 'Reviewer', description: '', order: 10, overrides: {} }],
    },
  )
})

// 「启用智能体团队」：开关属于部署，所以测试用一个假的 pluginManager 站位，它记得 profile 的选择。

/** 最像 profile bundle manager 的最小实现。
 * @param {{ installed?: boolean, enabled?: boolean, removable?: boolean, readOnlyReason?: string, application?: string, error?: object, warnings?: string[] }} [row] */
