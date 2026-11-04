/** 角色目录与增删改（create / rename / reset / delete / mode）。
 * 从 tests/plugin.test.mjs 拆分而来（超 400 行红线），测试体只做了 import 路径加深一层。 */
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
// 角色自己的 AGENTS.md 靠把 agent-instructions 行的 dshHome 指到角色目录接上：
// 文件就在 home 里，用户不用输路径，也不需要 loop 行才让 dsh 读到它。
        assert.equal(role.agentsMd.dshHome, role.dir)
        assert.equal(role.agentsMd.linked, true)
        assert.equal(role.capabilities.loop, undefined)

// 角色真的是那个文件 —— 索引只存设置。（它随第一个设置出现，所以先写一个。）
        await call(routes, COMMAND_URL, 'POST', { action: 'set-hide-chat-tab', enabled: true })
        const index = JSON.parse(await readFile(path.join(dir, 'roles.json'), 'utf8'))
        assert.equal(index.version, 3)
        assert.equal(index.roles, undefined)
        assert.equal(index.settings.hideChatTab, true)
        assert.deepEqual(JSON.parse(await readFile(role.roleFile, 'utf8')).id, 'team-reviewer')

// ……而规则文件是副本，不是指向主会话那份的引用。
        assert.equal(await readFile(role.agentsMdFile, 'utf8'), '# main session rules\n')
        await writeFile(path.join(home, 'AGENTS.md'), '# changed\n', 'utf8')
        assert.equal(await readFile(role.agentsMdFile, 'utf8'), '# main session rules\n')
      },
      undefined,
      { home },
    )
  })
})

// 详情面板能改 id。角色 id 同时是目录名、role.json 字段、注册出去的 preset id，
// 所以改名三样一起换（store.rename）：挪目录 → 重写文件 → 更新内存列表。
// AGENTS.md 跟着目录走；覆盖行按**行 id** 存，不随改名变；旧 preset 由 commit 的 removed 卸掉。
// 失败（占名 / 非法 id / 内置 preset 名）必须原地不动。

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

// 新 id 就是新身份：还能按它更新，不是只在返回值里换个字。
        const again = await call(routes, COMMAND_URL, 'POST', { action: 'update-role', id: 'team-qa-1', order: 3 })
        assert.equal(again.status, 200)
        assert.equal(again.json.state.roles.find((item) => item.id === 'team-qa-1').order, 3)

// 错误路径：占用的 id / 非法 id / 内置 preset 名 / 空 id。
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

// 插件门是同一个角色上的第三个维度，还原按钮也要清它。
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
// 文件回到主会话那份的副本，把行指到别的候选列表的 override 也一起消失。
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
// 插件门被同一个按钮清掉。
        assert.deepEqual(afterRows.capabilities.toolGate.deny, [])
// rows 是唯一剩下的结构维度：退役的 loop 块不会回来，规则文件接线也不是开关。
        assert.equal(afterRows.capabilities.loop, undefined)
        assert.equal(afterRows.agentsMd.linked, true)

// 不认识的项直接拒，不静默忽略。
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
// 第二层：除了身份，一切回到「刚建好」……
        assert.equal(after.name, 'Reviewer Two')
        assert.equal(after.description, '只看安全')
        assert.deepEqual(after.overrides, {})
        assert.deepEqual(after.capabilities, { mcp: { deny: [] }, toolGate: { deny: [] } })
// ……除了用户可能手写过的规则文件。
        assert.equal(await readFile(role.agentsMdFile, 'utf8'), '# my own rules\n')
// 接线路过重置仍在：它由角色目录推导，不是存下来、能被清掉的 override。
        assert.equal(after.agentsMd.dshHome, after.dir)
        assert.equal(after.agentsMd.linked, true)

        const removed = await call(routes, COMMAND_URL, 'POST', { action: 'delete-role', id: 'team-reviewer' })
        assert.equal(removed.status, 200)
// 第四层：开关与目录是一回事。
        await assert.rejects(() => stat(role.dir))
        assert.deepEqual((await call(routes, STATE_URL)).json.roles, [])
      },
      undefined,
      { home },
    )
  })
})
