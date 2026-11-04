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


test('create-role gives the role a directory with its own config and instructions', async () => {
  await withHome(async (home) => {
    await writeFile(path.join(home, 'AGENTS.md'), '# main session rules\n', 'utf8')

    await withPlugin(
      async ({ routes }, dir) => {
        const created = await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })
        assert.equal(created.status, 200)
        assert.equal(created.json.agentsMd.copied, true)

        const role = created.json.state.roles.find((item) => item.id === 'team-reviewer')
        assert.equal(role.dir, path.join(dir, 'team-reviewer'))
        assert.equal(role.roleFile, path.join(dir, 'team-reviewer', 'role.json'))
        assert.equal(role.agentsMdFile, path.join(dir, 'team-reviewer', 'AGENTS.md'))
        // §5.30: the role's own AGENTS.md is wired to it by pointing the
        // `agent-instructions` row's `dshHome` at the role directory — the file
        // sits in the home, so no path is typed by the user and no loop row is
        // needed to make dsh read it.
        assert.equal(role.agentsMd.dshHome, role.dir)
        assert.equal(role.agentsMd.linked, true)
        assert.equal(role.capabilities.loop, undefined)

        // The role really is the file — the index keeps settings and nothing else.
        // (It appears with the first setting, so write one first.)
        await call(routes, COMMAND_URL, 'POST', { action: 'set-hide-chat-tab', enabled: true })
        const index = JSON.parse(await readFile(path.join(dir, 'roles.json'), 'utf8'))
        assert.equal(index.version, 3)
        assert.equal(index.roles, undefined)
        assert.equal(index.settings.hideChatTab, true)
        assert.deepEqual(JSON.parse(await readFile(role.roleFile, 'utf8')).id, 'team-reviewer')

        // …and the rules file is a copy, not a reference to the main session's.
        assert.equal(await readFile(role.agentsMdFile, 'utf8'), '# main session rules\n')
        await writeFile(path.join(home, 'AGENTS.md'), '# changed\n', 'utf8')
        assert.equal(await readFile(role.agentsMdFile, 'utf8'), '# main session rules\n')
      },
      undefined,
      { home },
    )
  })
})

// 「你还得给我改 id 的地方啊，就放在名字下面一行」(user m20310)：详情面板能改 id。
// 角色 id 同时是目录名、role.json 里的字段、以及注册出去的 preset id，所以改名要
// 三样一起换（`store.rename`）：先把目录挪过去，再重写文件，再更新内存列表。角色自己
// 的 AGENTS.md 跟着目录走；覆盖行是按**行 id** 存的，不随角色改名而变；旧 preset 由
// `commit` 的 `removed` 卸掉。失败（占名 / 非法 id / 内置 preset 名）必须原地不动。

test('§5.57 renaming a role moves its directory, its file and its preset', async () => {
  await withHome(async (home) => {
    await writeFile(path.join(home, 'AGENTS.md'), '# main session rules\n', 'utf8')

    await withPlugin(
      async ({ registered, routes }, dir) => {
        const created = await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })
        const before = created.json.state.roles.find((item) => item.id === 'team-reviewer')
        assert.ok(before)
        await writeFile(before.agentsMdFile, '# hand written\n', 'utf8')
        await call(routes, COMMAND_URL, 'POST', {
          action: 'set-override',
          id: 'team-reviewer',
          row: 'tool-web',
          disabled: true,
        })

        const renamed = await call(routes, COMMAND_URL, 'POST', {
          action: 'update-role',
          id: 'team-reviewer',
          name: 'Reviewer 2',
          order: 2,
          newId: 'team-qa-1',
        })
        assert.equal(renamed.status, 200)
        assert.equal(renamed.json.id, 'team-qa-1')
        assert.equal(renamed.json.previousId, 'team-reviewer')
        assert.equal(renamed.json.renamed, true)
        // 旧 preset 被卸载、新的挂上 —— 名字换了，注册名也得换。
        assert.ok(renamed.json.result.removed.includes('team-reviewer'))
        assert.equal(registered.some((record) => record.id === 'team-reviewer' && !record.disposed), false)
        assert.equal(registered.some((record) => record.id === 'team-qa-1' && !record.disposed), true)

        assert.equal(renamed.json.state.roles.some((item) => item.id === 'team-reviewer'), false)
        const after = renamed.json.state.roles.find((item) => item.id === 'team-qa-1')
        assert.equal(after.name, 'Reviewer 2')
        assert.equal(after.order, 2)
        assert.equal(after.dir, path.join(dir, 'team-qa-1'))
        assert.equal(after.roleFile, path.join(dir, 'team-qa-1', 'role.json'))
        assert.equal(after.agentsMdFile, path.join(dir, 'team-qa-1', 'AGENTS.md'))
        assert.equal(after.agentsMd.dshHome, after.dir)
        // 覆盖行按行 id 存，改名不动它。
        assert.deepEqual(after.overrides['tool-web'], { disabled: true })

        // 磁盘上：旧目录没了、新 role.json 换了 id、手写的 AGENTS.md 跟着目录走。
        await assert.rejects(readFile(path.join(dir, 'team-reviewer', 'role.json'), 'utf8'))
        assert.equal(JSON.parse(await readFile(after.roleFile, 'utf8')).id, 'team-qa-1')
        assert.equal(await readFile(path.join(dir, 'team-qa-1', 'AGENTS.md'), 'utf8'), '# hand written\n')

        // 新 id 就是新身份：还能按它更新（不是只在返回值里换个字）。
        const again = await call(routes, COMMAND_URL, 'POST', { action: 'update-role', id: 'team-qa-1', order: 3 })
        assert.equal(again.status, 200)
        assert.equal(again.json.state.roles.find((item) => item.id === 'team-qa-1').order, 3)

        // 错误路径 —— 占用的 id / 非法 id / 内置 preset 名 / 空 id。
        const other = await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Other' })
        assert.equal(other.status, 200)
        const taken = await call(routes, COMMAND_URL, 'POST', {
          action: 'update-role',
          id: 'team-qa-1',
          newId: other.json.id,
        })
        assert.equal(taken.status, 400)
        assert.match(taken.json.error, /角色已存在/)
        const illegal = await call(routes, COMMAND_URL, 'POST', {
          action: 'update-role',
          id: 'team-qa-1',
          newId: 'team-测试',
        })
        assert.equal(illegal.status, 400)
        assert.match(illegal.json.error, /角色 id 必须是/)
        const reserved = await call(routes, COMMAND_URL, 'POST', {
          action: 'update-role',
          id: 'team-qa-1',
          newId: 'standard',
        })
        assert.equal(reserved.status, 400)
        assert.match(reserved.json.error, /不能是内置 preset/)
        const blank = await call(routes, COMMAND_URL, 'POST', {
          action: 'update-role',
          id: 'team-qa-1',
          newId: '   ',
        })
        assert.equal(blank.status, 400)
        assert.match(blank.json.error, /不能为空/)

        // 失败的改名原地不动：目录、文件、注册名都还在。
        const settled = await call(routes, STATE_URL)
        assert.equal(settled.json.roles.some((item) => item.id === 'team-qa-1'), true)
        assert.equal(JSON.parse(await readFile(path.join(dir, 'team-qa-1', 'role.json'), 'utf8')).id, 'team-qa-1')
        assert.equal(registered.some((record) => record.id === 'team-qa-1' && !record.disposed), true)
      },
      undefined,
      { home },
    )
  })
})

test('reset-item restores one dimension at a time', async () => {
  await withHome(async (home) => {
    await writeFile(path.join(home, 'AGENTS.md'), '# main session rules\n', 'utf8')

    await withPlugin(
      async ({ registered, routes }) => {
        const created = await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })
        const role = created.json.state.roles.find((item) => item.id === 'team-reviewer')

        await call(routes, COMMAND_URL, 'POST', {
          action: 'set-override',
          id: 'team-reviewer',
          row: 'tool-web',
          disabled: true,
        })
        await call(routes, COMMAND_URL, 'POST', {
          action: 'set-mcp',
          id: 'team-reviewer',
          server: 'github',
          enabled: false,
        })

        // §5.55 — the plugin gate is a third dimension on the same role, and the
        // 还原 button is expected to clear it too.
        await call(routes, COMMAND_URL, 'POST', {
          action: 'set-switches',
          id: 'team-reviewer',
          tools: { list_agents: false },
        })

        // --- agents-md ----------------------------------------------------
        await writeFile(role.agentsMdFile, '# hand written\n', 'utf8')
        await call(routes, COMMAND_URL, 'POST', {
          action: 'set-override',
          id: 'team-reviewer',
          row: 'agent-instructions',
          config: { instructionFileCandidates: ['RULES.md'] },
        })
        const mdReset = await call(routes, COMMAND_URL, 'POST', {
          action: 'reset-item',
          id: 'team-reviewer',
          item: 'agents-md',
        })
        assert.equal(mdReset.status, 200)
        const afterMd = mdReset.json.state.roles.find((item) => item.id === 'team-reviewer')
        // The file goes back to a copy of the main session's, and the override
        // that pointed the row at another candidate list goes with it.
        assert.equal(await readFile(afterMd.agentsMdFile, 'utf8'), '# main session rules\n')
        assert.equal(afterMd.agentsMd.source, path.join(home, 'AGENTS.md'))
        assert.equal(afterMd.overrides['agent-instructions'], undefined)
        assert.equal(afterMd.overrides['tool-web'].disabled, true)

        // --- rows ---------------------------------------------------------
        const rowsReset = await call(routes, COMMAND_URL, 'POST', {
          action: 'reset-item',
          id: 'team-reviewer',
          item: 'rows',
        })
        assert.equal(rowsReset.status, 200)
        const afterRows = rowsReset.json.state.roles.find((item) => item.id === 'team-reviewer')
        assert.deepEqual(afterRows.overrides, {})
        assert.deepEqual(afterRows.capabilities.mcp.deny, [])
        // §5.55 — the plugin gate is cleared by the same button.
        assert.deepEqual(afterRows.capabilities.toolGate.deny, [])
        // §5.30: `rows` is the only structural dimension left; the retired loop
        // block never comes back, and the instruction wiring is not a switch.
        assert.equal(afterRows.capabilities.loop, undefined)
        assert.equal(afterRows.agentsMd.linked, true)

        // An unknown item is refused outright rather than silently ignored.
        const unknown = await call(routes, COMMAND_URL, 'POST', {
          action: 'reset-item',
          id: 'team-reviewer',
          item: 'everything',
        })
        assert.equal(unknown.status, 400)
        assert.match(unknown.json.error, /未知的还原项/)
      },
      undefined,
      { home },
    )
  })
})

test('reset-role keeps the identity and the file, delete-role removes the directory', async () => {
  await withHome(async (home) => {
    await writeFile(path.join(home, 'AGENTS.md'), '# main session rules\n', 'utf8')

    await withPlugin(
      async ({ routes }) => {
        const created = await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })
        const role = created.json.state.roles.find((item) => item.id === 'team-reviewer')

        await call(routes, COMMAND_URL, 'POST', {
          action: 'update-role',
          id: 'team-reviewer',
          name: 'Reviewer Two',
          description: '只看安全',
        })
        await writeFile(role.agentsMdFile, '# my own rules\n', 'utf8')
        await call(routes, COMMAND_URL, 'POST', {
          action: 'set-override',
          id: 'team-reviewer',
          row: 'tool-web',
          disabled: true,
        })
        await call(routes, COMMAND_URL, 'POST', {
          action: 'set-mcp',
          id: 'team-reviewer',
          server: 'github',
          enabled: false,
        })

        const reset = await call(routes, COMMAND_URL, 'POST', { action: 'reset-role', id: 'team-reviewer' })
        assert.equal(reset.status, 200)
        const after = reset.json.state.roles.find((item) => item.id === 'team-reviewer')
        // Layer 2: everything back to "just created" except the identity …
        assert.equal(after.name, 'Reviewer Two')
        assert.equal(after.description, '只看安全')
        assert.deepEqual(after.overrides, {})
        assert.deepEqual(after.capabilities, { mcp: { deny: [] }, toolGate: { deny: [] } })
        // … and except the rules file the user may have written by hand.
        assert.equal(await readFile(role.agentsMdFile, 'utf8'), '# my own rules\n')
        // The wiring survives the reset: it is derived from the role's directory,
        // not stored as an override that could be cleared.
        assert.equal(after.agentsMd.dshHome, after.dir)
        assert.equal(after.agentsMd.linked, true)

        const removed = await call(routes, COMMAND_URL, 'POST', { action: 'delete-role', id: 'team-reviewer' })
        assert.equal(removed.status, 200)
        // Layer 4: the switches and the directory are the same thing.
        await assert.rejects(() => stat(role.dir))
        assert.deepEqual((await call(routes, STATE_URL)).json.roles, [])
      },
      undefined,
      { home },
    )
  })
})
