/** 技能：模式自带技能行与 pick 技能的发现、消费与还原。
 * 假 Cordis 上下文见 tests/harness.mjs，技能目录夹具 skillHome() 见 tests/support/plugin-fixtures.mjs。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import { call, withPlugin } from '../support/harness.mjs'
import path from 'node:path'
import { skillHome, STATE_URL, COMMAND_URL } from '../support/plugin-fixtures.mjs'

test('/state lists what the deployment\'s own roots hold', async () => {
  const { home, push, pptx, solo } = await skillHome()
  try {
    await withPlugin(
      async ({ routes }) => {
        const state = await call(routes, STATE_URL)
        assert.equal(state.status, 200)
        assert.equal(state.json.skills.error, null)
        assert.deepEqual(state.json.skills.row, {
          filesystem: 'skill-filesystem',
          tool: 'tool-skill',
          plugin: '@deepseek-ai/dsh-skill-filesystem',
          toolPlugin: '@deepseek-ai/dsh-tool-skill',
        })

        const userRoot = state.json.skills.roots.find((root) => root.id === 'user-dsh')
        assert.equal(userRoot.path, path.join(home, 'skills'))
        assert.equal(userRoot.exists, true)
// 这两个根在本机没人用，缺目录不算错。
        assert.equal(state.json.skills.roots.find((root) => root.id === 'user-agents').exists, false)

// 逐个根断言而非整体断言：项目根的 cwd 是真目录，开发者本机可能真放东西。
        const mine = state.json.skills.available.filter((skill) => skill.root === 'user-dsh')
        assert.deepEqual(
          mine.map((skill) => skill.name),
          ['pptx', 'push', 'solo'],
        )
        assert.deepEqual(mine.find((skill) => skill.name === 'push').dir, push)
        assert.equal(mine.find((skill) => skill.name === 'pptx').description, '做 PPT')
// 文件形式的那个挂的是它的父目录，不是文件本身。
        assert.equal(mine.find((skill) => skill.name === 'solo').dir, path.join(home, 'skills'))
        assert.equal(mine.find((skill) => skill.name === 'solo').kind, 'file')
        assert.equal(mine.some((skill) => skill.label === 'empty-dir' || skill.label === 'no-frontmatter'), false)

// 默认继承：角色不点名技能时什么都不组合。
        assert.deepEqual(state.json.roles[0].skills, {
          mode: 'inherit',
          ids: [],
          dirs: [],
          missing: [],
          hasFilesystemRow: true,
          hasToolRow: true,
        })
      },
      { version: 1, roles: [{ id: 'team-architect', name: '架构师', description: '', order: 10, overrides: {} }] },
      { home },
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('picking skills rewrites the existing row and nothing else', async () => {
  const { home, push } = await skillHome()
  try {
    await withPlugin(
      async ({ registered, routes }, dir) => {
        const picked = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-skills',
          id: 'team-architect',
          mode: 'pick',
          ids: ['push'],
        })
        assert.equal(picked.status, 200)
        assert.deepEqual(picked.json.skills, { mode: 'pick', ids: ['push'] })
        assert.deepEqual(picked.json.state.roles[0].skills, {
          mode: 'pick',
          ids: ['push'],
          dirs: [push],
          missing: [],
          hasFilesystemRow: true,
          hasToolRow: true,
        })

// 行仍是模式自己的，只是 config 指向选中的那个目录——没增行也没删行。
        const before = registered.filter((record) => record.id === 'team-architect').at(-1)
        const row = before.definition.plugins.find((entry) => entry.id === 'skill-filesystem')
        assert.deepEqual(row.config, { includeDefaultRoots: false, customSkillDirs: [push] })
        assert.equal(before.definition.plugins.some((entry) => entry.id === 'tool-skill'), true)
        assert.equal(before.definition.plugins.filter((entry) => entry.id === 'skill-filesystem').length, 1)

// 这是存下来的决定，不是界面状态。
        const onDisk = JSON.parse(await readFile(path.join(dir, 'team-architect', 'role.json'), 'utf8'))
        assert.deepEqual(onDisk.skills, { mode: 'pick', ids: ['push'] })

// 回到继承：行又归模式，且选择保留，切回来能还原。
        const restored = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-skills',
          id: 'team-architect',
          mode: 'inherit',
          ids: ['push'],
        })
        assert.equal(restored.status, 200)
        assert.equal(restored.json.state.roles[0].skills.mode, 'inherit')
        assert.deepEqual(restored.json.state.roles[0].skills.ids, ['push'])
        assert.deepEqual(restored.json.state.roles[0].skills.dirs, [])
        const after = registered.filter((record) => record.id === 'team-architect').at(-1)
        assert.equal(after.definition.plugins.find((entry) => entry.id === 'skill-filesystem').config, undefined)
      },
      { version: 1, roles: [{ id: 'team-architect', name: '架构师', description: '', order: 10, overrides: {} }] },
      { home },
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a skill this deployment does not hold is refused, not stored', async () => {
  const { home } = await skillHome()
  try {
    await withPlugin(
      async ({ routes }, dir) => {
        const refused = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-skills',
          id: 'team-architect',
          mode: 'pick',
          ids: ['push', 'ghost-skill'],
        })
        assert.equal(refused.status, 400)
        assert.match(refused.json.error, /这个部署里没有技能：ghost-skill/)
// 文件与模式都没动。
        const onDisk = JSON.parse(await readFile(path.join(dir, 'team-architect', 'role.json'), 'utf8'))
        assert.deepEqual(onDisk.skills, { mode: 'inherit', ids: [] })

        const badMode = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-skills',
          id: 'team-architect',
          mode: 'everything',
          ids: [],
        })
        assert.equal(badMode.status, 400)
        assert.match(badMode.json.error, /技能模式必须是 inherit 或 pick/)

        const noRole = await call(routes, COMMAND_URL, 'POST', { action: 'set-skills', id: 'team-nobody', mode: 'pick', ids: [] })
        assert.equal(noRole.status, 400)
        assert.match(noRole.json.error, /角色不存在/)
      },
      { version: 1, roles: [{ id: 'team-architect', name: '架构师', description: '', order: 10, overrides: {} }] },
      { home },
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('极简模式 gains the discovery row and its consumer as a pair', async () => {
  const { home, push } = await skillHome()
  try {
    await withPlugin(
      async ({ registered, routes }) => {
        const picked = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-skills',
          id: 'team-architect',
          mode: 'pick',
          ids: ['push'],
        })
        assert.equal(picked.status, 200)
// 面板被告知模式两行都没有，好让它照实说。
        assert.equal(picked.json.state.roles[0].skills.hasFilesystemRow, false)
        assert.equal(picked.json.state.roles[0].skills.hasToolRow, false)

        const latest = registered.filter((record) => record.id === 'team-architect').at(-1)
        const ids = latest.definition.plugins.map((entry) => entry.id)
        assert.equal(ids.includes('skill-filesystem'), true)
        assert.equal(ids.includes('tool-skill'), true)
// 先发现再消费：没有后者前者就是摆设。
        assert.ok(ids.indexOf('skill-filesystem') < ids.indexOf('tool-skill'))
        assert.deepEqual(latest.definition.plugins.find((entry) => entry.id === 'skill-filesystem').config, {
          includeDefaultRoots: false,
          customSkillDirs: [push],
        })
        assert.equal(latest.definition.plugins.find((entry) => entry.id === 'tool-skill').config, undefined)
      },
      {
        version: 1,
        roles: [{ id: 'team-architect', name: '架构师', description: '', order: 10, mode: 'minimal', overrides: {} }],
      },
      { home },
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('both resets forget the decision, and a hand-written config wins', async () => {
  const { home } = await skillHome()
  try {
    await withPlugin(
      async ({ registered, routes }) => {
        await call(routes, COMMAND_URL, 'POST', { action: 'set-skills', id: 'team-architect', mode: 'pick', ids: ['push', 'pptx'] })

// 手写的 customSkillDirs 是用户的，等同指令行：组合不得覆盖。
        await call(routes, COMMAND_URL, 'POST', {
          action: 'set-override',
          id: 'team-architect',
          row: 'skill-filesystem',
          config: { includeDefaultRoots: true, customSkillDirs: ['D:\\mine'] },
        })
        const handWritten = registered.filter((record) => record.id === 'team-architect').at(-1)
        assert.deepEqual(handWritten.definition.plugins.find((entry) => entry.id === 'skill-filesystem').config, {
          includeDefaultRoots: true,
          customSkillDirs: ['D:\\mine'],
        })

// 清掉覆盖，行还给 pick。
        await call(routes, COMMAND_URL, 'POST', { action: 'clear-override', id: 'team-architect', row: 'skill-filesystem' })
        const backToPick = registered.filter((record) => record.id === 'team-architect').at(-1)
        assert.equal(
          backToPick.definition.plugins.find((entry) => entry.id === 'skill-filesystem').config.includeDefaultRoots,
          false,
        )

// 「还原技能」是切模式，不是丢掉一个长选择。
        const reset = await call(routes, COMMAND_URL, 'POST', { action: 'reset-item', id: 'team-architect', item: 'skills' })
        assert.equal(reset.status, 200)
        assert.equal(reset.json.state.roles[0].skills.mode, 'inherit')
        assert.deepEqual(reset.json.state.roles[0].skills.ids, ['push', 'pptx'])

        const unknown = await call(routes, COMMAND_URL, 'POST', { action: 'reset-item', id: 'team-architect', item: 'nope' })
        assert.equal(unknown.status, 400)
        assert.match(unknown.json.error, /未知的还原项/)

// reset-role 恢复出厂态，选择也一起回。
        const role = await call(routes, COMMAND_URL, 'POST', { action: 'reset-role', id: 'team-architect' })
        assert.equal(role.status, 200)
        assert.deepEqual(role.json.state.roles[0].skills, {
          mode: 'inherit',
          ids: [],
          dirs: [],
          missing: [],
          hasFilesystemRow: true,
          hasToolRow: true,
        })
      },
      { version: 1, roles: [{ id: 'team-architect', name: '架构师', description: '', order: 10, overrides: {} }] },
      { home },
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('the browser half offers the per-role skill list', async () => {
  const source = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
// 一块面板、一个动作、一个状态字段。
  assert.match(source, /function SkillsPanel\(/)
  assert.match(source, /h\(SkillsPanel,\s*\{/)
  assert.match(source, /skills:\s*state\.skills/)
  assert.match(source, /action:\s*'set-skills'/)
// 勾选就是选用：勾一下技能，角色自动切 pick。
  assert.match(source, /onSet\(\{\s*mode:\s*'pick'/)
// 标题右边那格是全选（半选 = 只勾了一部分），不是模式开关
// 全不勾 = 一个技能都不加载，回「继承」由下面的还原按钮负责。
  assert.match(source, /const onBulk = \(on\) =>/)
  assert.match(source, /node\.indeterminate = pick && chosen\.size > 0 && !allChosen/)
// 它挂在能力行里、紧跟 MCP 那一块后面（同一层）。
  assert.ok(source.indexOf('h(McpPanel, {') < source.indexOf('h(SkillsPanel, {'))
// 两种诚实的边界都写明，不藏。
  assert.match(source, /hasFilesystemRow === false/)
  assert.match(source, /skillsGlobal/)
// 「继承」那一档仍要说清它跟随模式默认；「pick 档现在挂着 N 个技能目录 / 会出现在 <available_skills> 里」这句已删（跟表格对不齐、也没必要）。
  assert.match(source, /这个角色跟随模式默认（不筛选）/)
})
