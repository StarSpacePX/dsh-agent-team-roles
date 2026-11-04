// 行数已经审批
/** 纯组合层与角色存储的测试。全部跑在仓库内的预设夹具上（默认 standard，测模式切换时用其它三个），
 * 所以这套用例同时断言四份声明都在、可解析、形状符合 UI 预期。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  DEFAULT_MODE,
  MODES,
  applyConfig,
  categorize,
  composeRows,
  describeRows,
  modeLabel,
  normalizeMode,
  resolveGate,
  shippedLabel,
} from '../lib/template.js'
import { shippedPreset } from './support/shipped-presets.mjs'
import { ID_PATTERN, RESERVED_IDS, RoleStore, normalizeRole } from '../lib/store.js'
import { ROLE_PALETTE, colorForRoleId, nextRoleColor } from '../lib/roleColor.js'
import { buildDefinition, buildDefinitions, createRole, slugify, withInstructionHome } from '../lib/roles.js'

/** 出厂模式的顶层行（测试夹具）。插件不再自带快照：运行时从部署的 Loader 读预设声明，
 * 测试里没有部署，所以那四份声明放在 tests/fixtures/presets/。 */
const loadTemplate = async (mode = DEFAULT_MODE) => {
  const id = normalizeMode(mode)
  return { source: { presetId: id, file: null, live: true }, plugins: shippedPreset(id).plugins }
}

test('resolveGate understands the two shipped platform comparisons', () => {
  assert.equal(resolveGate({ __js__: "process.platform === 'win32'" }, 'win32'), true)
  assert.equal(resolveGate({ __js__: "process.platform === 'win32'" }, 'linux'), false)
  assert.equal(resolveGate({ __js__: "process.platform !== 'win32'" }, 'win32'), false)
  assert.equal(resolveGate({ __js__: "process.platform !== 'win32'" }, 'linux'), true)
  assert.equal(resolveGate(true, 'win32'), true)
  assert.equal(resolveGate(undefined, 'win32'), undefined)
})

test('resolveGate refuses to guess an expression it does not understand', () => {
  assert.equal(resolveGate({ __js__: 'Math.random() > 0.5' }, 'win32'), undefined)
  assert.equal(resolveGate({ other: 1 }, 'win32'), undefined)
})

test('applyConfig deletes keys a patch sets to null', () => {
  assert.deepEqual(applyConfig({ a: 1, b: 2 }, { b: null, c: 3 }), { a: 1, c: 3 })
  assert.deepEqual(applyConfig(undefined, { a: 1 }), { a: 1 })
  assert.deepEqual(applyConfig({ a: 1 }, undefined), { a: 1 })
  assert.equal(applyConfig(undefined, undefined), undefined)
})

test('categorize places the rows the requirements name', () => {
  assert.equal(categorize({ id: 'planning', group: true }, true), 'group')
  assert.equal(categorize({ id: 'agent-instructions' }), 'agents-md')
  assert.equal(categorize({ id: 'tool-fs' }), 'tool')
  assert.equal(categorize({ id: 'skill-filesystem' }), 'skill')
  assert.equal(categorize({ id: 'some-mcp-server' }), 'mcp')
  assert.equal(categorize({ id: 'agent-loop' }), 'loop')
})

// 用户的模型是「AGENTS.md 就是身份描述和一些规则」：persona 归到 AGENTS.md 组，不再有 identity 键。
test('persona is part of the AGENTS.md dimension, not an identity of its own', () => {
  assert.equal(categorize({ id: 'persona' }), 'agents-md')
  assert.equal(categorize({ id: 'persona', name: '@deepseek-ai/dsh-persona' }), 'agents-md')
  assert.notEqual(categorize({ id: 'persona' }), 'identity')
})

test('the bundled snapshot is the standard preset and carries both gates', async () => {
  const template = await loadTemplate()
  assert.equal(template.source.presetId, 'standard')
  assert.ok(template.plugins.length > 10)

  const bash = template.plugins.find((row) => row.id === 'tool-bash')
  const pwsh = template.plugins.find((row) => row.id === 'tool-pwsh')
  assert.equal(bash.disabled.__js__, "process.platform === 'win32'")
  assert.equal(pwsh.disabled.__js__, "process.platform !== 'win32'")
})

test('every row id in the shipped fixture is unique, groups included', async () => {
  const template = await loadTemplate()

  const walk = (rows) => rows.flatMap((row) => [row.id, ...(Array.isArray(row.config) ? walk(row.config) : [])])
  const ids = walk(template.plugins)

// 角色的 override 按**裸行 id** 寻址，不是 UI 显示的 parent/child 路径；
// 重复 id 会让两行共用一份 override，所以这里断言生成器的输出。
  assert.equal(new Set(ids).size, ids.length, `重复的行 id：${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`)
  assert.equal(ids.length, 32)
})

test('composeRows turns gates into booleans and honours overrides', async () => {
  const template = await loadTemplate()

  const windows = composeRows(template.plugins, 'win32')
  assert.equal(windows.find((row) => row.id === 'tool-bash').disabled, true)
  assert.equal('disabled' in windows.find((row) => row.id === 'tool-pwsh'), false)

  const linux = composeRows(template.plugins, 'linux')
  assert.equal('disabled' in linux.find((row) => row.id === 'tool-bash'), false)
  assert.equal(linux.find((row) => row.id === 'tool-pwsh').disabled, true)

  const overridden = composeRows(template.plugins, 'win32', { 'tool-bash': { disabled: false } })
  assert.equal(overridden.find((row) => row.id === 'tool-bash').disabled, false)
})

test('composeRows keeps group children as rows of their group', async () => {
  const template = await loadTemplate()
  const rows = composeRows(template.plugins, 'win32')
  const delegation = rows.find((row) => row.id === 'delegation')

  assert.equal(delegation.group, true)
  assert.ok(Array.isArray(delegation.config))
  assert.ok(delegation.config.some((row) => row.id === 'tool-subagent'))
})

// 角色组合在 dsh-tool-subagent 上保留 modelSelectionSettings: true。
// 成员在创建窗口里被重绑到角色预设，早于父级 preset-standard 的常驻监听装上自己那份，
// 于是 list_subagent_models 这个全局具名工具又只有一个归属。
test('composeRows keeps the globally named subagent catalog (§5.53)', async () => {
  const template = await loadTemplate()
  const raw = template.plugins
    .find((row) => row.id === 'delegation')
    .config.find((row) => row.id === 'tool-subagent')

  // The snapshot records what the deployment shipped …
  assert.equal(raw.config.modelSelectionSettings, true)

  const delegation = composeRows(template.plugins, 'win32').find((row) => row.id === 'delegation')
  const subagent = delegation.config.find((row) => row.id === 'tool-subagent')

// 组合不动它，所以角色成员拿到的模型目录与官方子代理一致；那一行的其它设置也照旧保留。
  assert.equal(subagent.config.modelSelectionSettings, true)
  assert.equal(subagent.config.toolName, 'subagent')
  assert.equal(subagent.config.provider, 'spawn')
  assert.equal(subagent.config.backgroundMode, 'continuable')
  assert.notEqual(delegation.disabled, true)

  // The fork row never published the global name and is left exactly as it was.
  const fork = delegation.config.find((row) => row.id === 'tool-subagent-fork')
  assert.equal('modelSelectionSettings' in fork.config, false)

  // A per-role override is the supported opt-out, and it still wins.
  const off = composeRows(template.plugins, 'win32', {
    'tool-subagent': { config: { modelSelectionSettings: false } },
  })
  assert.equal(
    off
      .find((row) => row.id === 'delegation')
      .config.find((row) => row.id === 'tool-subagent').config.modelSelectionSettings,
    false,
  )

  // Every bundled mode that ships the delegation group keeps the shipped flag.
  for (const mode of MODES) {
    const group = composeRows((await loadTemplate(mode.id)).plugins, 'win32').find(
      (row) => row.id === 'delegation',
    )
    if (group === undefined) continue
    assert.equal(
      group.config.find((row) => row.id === 'tool-subagent').config.modelSelectionSettings,
      true,
      `${mode.id} 的 delegation 组`,
    )
  }
})

test('describeRows flattens groups into parent/child paths', async () => {
  const template = await loadTemplate()
  const rows = describeRows(template.plugins, 'win32')

  const planning = rows.find((row) => row.path === 'planning')
  const planMode = rows.find((row) => row.path === 'planning/plan-mode')

  assert.ok(planning)
  assert.ok(planMode)
  assert.equal(planMode.parent, 'planning')
// isolate 是只有分组能声明的，UI 读它：组头会说哪些服务跑在独立 realm 里；子行没有。
  assert.deepEqual(planning.isolate, { planMode: true })
  assert.equal(planMode.isolate, null)
})

test('describeRows reports overrides distinctly from the template', async () => {
  const template = await loadTemplate()
  const rows = describeRows(template.plugins, 'win32', { 'tool-bash': { disabled: false } })
  const bash = rows.find((row) => row.id === 'tool-bash')

  assert.equal(bash.templateDisabled, true)
  assert.equal(bash.disabled, false)
  assert.equal(bash.hasOverride, true)
})

test('normalizeRole rejects ids the loader could not mount', () => {
  assert.throws(() => normalizeRole({ id: 'Bad Id', name: 'x' }), /角色 id/)
  assert.throws(() => normalizeRole({ id: 'ok', name: '' }), /名字/)
  assert.ok(ID_PATTERN.test('team-architect'))
  assert.ok(RESERVED_IDS.has('standard'))
  assert.throws(() => normalizeRole({ id: 'standard', name: 'x' }), /内置 preset/)
})

test('normalizeRole keeps only meaningful overrides', () => {
  const role = normalizeRole({
    id: 'team-a',
    name: 'A',
    overrides: {
      'tool-bash': { disabled: true },
      'tool-web': { config: { fetch: false } },
      empty: {},
      junk: 'nope',
    },
  })

  assert.deepEqual(Object.keys(role.overrides).sort(), ['tool-bash', 'tool-web'])
})

async function withStore(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-roles-'))
  try {
    await run(new RoleStore(dir), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('RoleStore round-trips through disk', async () => {
  await withStore(async (store, dir) => {
    await store.load()
    assert.deepEqual(store.roles, [])

    await store.upsert({ id: 'team-a', name: 'A', description: 'first', order: 5 })
    await store.upsert({ id: 'team-b', name: 'B' })

    const reopened = new RoleStore(dir)
    await reopened.load()
    assert.deepEqual(
      reopened.roles.map((role) => role.id),
      ['team-a', 'team-b'],
    )
    assert.equal(reopened.find('team-a').order, 5)

    assert.equal(await reopened.remove('team-a'), true)
    assert.equal(await reopened.remove('team-a'), false)

    const final = new RoleStore(dir)
    await final.load()
    assert.deepEqual(
      final.roles.map((role) => role.id),
      ['team-b'],
    )
  })
})

test('a load-save cycle keeps the write stamps instead of dropping them', async () => {
  await withStore(async (store, dir) => {
    await store.load()
    await store.upsert({ id: 'team-stamped', name: 'Stamped' })

    const reopened = new RoleStore(dir)
    await reopened.load()
    const { createdAt, updatedAt } = reopened.find('team-stamped')
    assert.equal(typeof createdAt, 'string')
    assert.equal(typeof updatedAt, 'string')

// 别的角色触发的保存不能把它们抹掉：文件必须是定点，否则每次 load-write 都偷偷重写文档。
    await reopened.upsert({ id: 'team-other', name: 'Other' })
    await reopened.remove('team-other')

    const final = new RoleStore(dir)
    await final.load()
    assert.equal(final.find('team-stamped').createdAt, createdAt)
    assert.equal(final.find('team-stamped').updatedAt, updatedAt)
  })
})

test('RoleStore refuses to overwrite a file it could not parse', async () => {
  await withStore(async (store, dir) => {
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'roles.json'), '{ not json', 'utf8')

    await assert.rejects(() => store.load())
    await assert.rejects(() => store.save(), /拒绝覆盖/)
  })
})

test('RoleStore writes each role into its own directory and leaves no temp file', async () => {
  await withStore(async (store, dir) => {
    await store.load()
    await store.upsert({ id: 'team-a', name: 'A' })

// 角色现在是自己一个文件，索引只放设置 —— 这才让「每个角色一个 json」真的成立。
    const text = await readFile(path.join(dir, 'team-a', 'role.json'), 'utf8')
    assert.equal(JSON.parse(text).id, 'team-a')

    const { readdir } = await import('node:fs/promises')
    assert.deepEqual(await readdir(dir), ['team-a'])
    assert.deepEqual(await readdir(path.join(dir, 'team-a')), ['role.json'])
  })
})

test('RoleStore migrates a v1 index into per-role files', async () => {
  await withStore(async (store, dir) => {
    await mkdir(dir, { recursive: true })
    await writeFile(
      path.join(dir, 'roles.json'),
      JSON.stringify({
        version: 1,
        settings: { hideChatTab: true },
        roles: [{ id: 'team-old', name: 'Old', description: 'inline', order: 5 }],
      }),
      'utf8',
    )

    await store.load()
    assert.deepEqual(store.migrated, ['team-old'])
    assert.deepEqual(
      store.roles.map((role) => role.id),
      ['team-old'],
    )
    assert.equal(store.settings.hideChatTab, true)

    // The inline copy is gone, the role file is not.
    const index = JSON.parse(await readFile(path.join(dir, 'roles.json'), 'utf8'))
    assert.equal(index.version, 3)
    assert.deepEqual(index.roles, undefined)
    const role = JSON.parse(await readFile(path.join(dir, 'team-old', 'role.json'), 'utf8'))
    assert.equal(role.description, 'inline')

    // A second load is a no-op: nothing is migrated twice.
    const reopened = new RoleStore(dir)
    await reopened.load()
    assert.deepEqual(reopened.migrated, [])
  })
})

test('RoleStore delete removes the role directory and everything in it', async () => {
  await withStore(async (store, dir) => {
    await store.load()
    await store.upsert({ id: 'team-a', name: 'A' })
    await writeFile(path.join(dir, 'team-a', 'AGENTS.md'), '# rules\n', 'utf8')

    assert.equal(await store.remove('team-a'), true)
    const { readdir } = await import('node:fs/promises')
    assert.deepEqual(await readdir(dir), [])
  })
})

test('a role file whose id does not match its directory shows up as broken', async () => {
  await withStore(async (store, dir) => {
    await mkdir(path.join(dir, 'team-lies'), { recursive: true })
    await writeFile(
      path.join(dir, 'team-lies', 'role.json'),
      JSON.stringify({ id: 'team-true', name: 'True' }),
      'utf8',
    )

    await store.load()
    assert.deepEqual(
      store.roles.map((role) => role.id),
      ['team-lies'],
    )
    assert.equal(store.roles[0].invalid, true)
  })
})

test('slugify derives a mountable id from a free-form name', () => {
  assert.equal(slugify('Architect', 'team-'), 'team-architect')
  assert.equal(slugify('  QA / Lead  ', 'team-'), 'team-qa-lead')
  assert.match(slugify('架构师', 'team-'), /^team-r[0-9a-z]+$/)
  assert.notEqual(slugify('架构师', 'team-'), slugify('设计师', 'team-'))
})

test('buildDefinition produces a preset the registry will accept', async () => {
  const template = await loadTemplate()
  const role = createRole('team-architect', '架构师', template)
  role.overrides = { 'tool-bash': { disabled: false } }

  const definition = buildDefinition(role, template, 'win32')
  assert.equal(definition.id, 'team-architect')
  assert.equal(definition.name, '架构师')
  assert.equal(typeof definition.order, 'number')
  assert.equal(definition.plugins.find((row) => row.id === 'tool-bash').disabled, false)
})

test('buildDefinitions skips damaged roles instead of throwing', async () => {
  const template = await loadTemplate()
  const { definitions, skipped } = buildDefinitions(
    [createRole('team-a', 'A', template), { id: 'broken', invalid: true }],
    template,
  )

  assert.deepEqual(definitions.map((definition) => definition.id), ['team-a'])
  assert.equal(skipped.length, 1)
})

test('withInstructionHome leaves the composition alone when there is no directory', () => {
  const overrides = { 'tool-bash': { disabled: true } }
  assert.equal(withInstructionHome(overrides, ''), overrides)
  assert.equal(withInstructionHome(overrides, undefined), overrides)
  assert.equal(withInstructionHome(overrides, '   '), overrides)
})

test('withInstructionHome points the existing agent-instructions row at the role', () => {
  const overrides = { 'agent-instructions': { config: { instructionFileCandidates: ['RULES.md'] } } }
  const next = withInstructionHome(overrides, 'C:\\roles\\team-architect')

  assert.equal(next['agent-instructions'].config.dshHome, 'C:\\roles\\team-architect')
  // The user's own keys survive: this adds one key, it does not replace the row.
  assert.deepEqual(next['agent-instructions'].config.instructionFileCandidates, ['RULES.md'])
  // The original object is not mutated — the store's copy is the source of truth.
  assert.equal(overrides['agent-instructions'].config.dshHome, undefined)
})

test('withInstructionHome respects a dshHome the role already declares', () => {
  const explicit = { 'agent-instructions': { config: { dshHome: 'D:\\shared' } } }
  assert.equal(withInstructionHome(explicit, 'C:\\roles\\team-architect')['agent-instructions'].config.dshHome, 'D:\\shared')

// null 是 applyConfig 的「删掉这个键」= 继承部署的 ~/.dsh，没有指名任何目录，不算「选了别处」。
// 让它赢会把角色的 AGENTS.md 注入两遍：角色目录就在 ~/.dsh 下，上游去重只折叠同一目录的文件。
  const inherit = { 'agent-instructions': { config: { dshHome: null } } }
  assert.equal(
    withInstructionHome(inherit, 'C:\\roles\\team-architect')['agent-instructions'].config.dshHome,
    'C:\\roles\\team-architect',
  )
})

test('buildDefinition wires the role directory into the composed preset', async () => {
  const template = await loadTemplate()
  const role = createRole('team-architect', '架构师', template)
  const home = 'C:\\roles\\team-architect'

  const definition = buildDefinition(role, template, 'win32', { dirOf: () => home })
  const row = definition.plugins.find((plugin) => plugin.id === 'agent-instructions')

// 这一行快照里本来就有，角色只往 config 加 dshHome，于是 dsh-agent-instructions 加载 <roleDir>/AGENTS.md，
// 与任务在哪个目录跑无关。
  assert.equal(row.config.dshHome, home)
  assert.equal(row.config.maxBytes, 65536)
  // No loop row, ever (§5.30): the agent-factory slot is single and taken.
  assert.equal(definition.plugins.some((plugin) => /agent-loop/.test(String(plugin.id))), false)

  // Without a `dirOf` there is no directory to point at, so nothing is added.
  const bare = buildDefinition(role, template, 'win32')
  assert.equal(bare.plugins.find((plugin) => plugin.id === 'agent-instructions').config.dshHome, undefined)
})

test('the context switch moves the shipped delegation row between providers', async () => {
  const template = await loadTemplate()
  const role = createRole('team-architect', '架构师', template)
  /** The `delegation` group is where the model-facing delegation tools live. */
  const delegation = (definition) => definition.plugins.find((row) => row.id === 'delegation').config
  const subagent = (definition) => delegation(definition).find((row) => row.id === 'tool-subagent')

  // The template's own value: a fresh child, zero inherited context.
  const fresh = buildDefinition(role, template, 'win32')
  assert.equal(subagent(fresh).config.provider, 'spawn')
  assert.equal(subagent(fresh).config.toolName, 'subagent')

// 「上下文是否继承主会话」是模板已有那一行上的一个 config 键：开关不加行、不改工具名。
  role.overrides = { 'tool-subagent': { config: { provider: 'fork' } } }
  const inherit = buildDefinition(role, template, 'win32')
  assert.equal(subagent(inherit).config.provider, 'fork')
  assert.equal(subagent(inherit).config.toolName, 'subagent')
  // The fork tool is a separate, untouched row, and the group keeps its size.
  assert.equal(delegation(inherit).some((row) => row.id === 'tool-subagent-fork'), true)
  assert.equal(delegation(inherit).length, delegation(fresh).length)
})

// 四种模式：角色存「按哪个部署预设构建」，行来自那份预设的声明（运行时读，无可复制的快照）。

test('the four known modes are still the deployment’s four, and each is its own composition', async () => {
  assert.deepEqual(
    MODES.map((mode) => mode.id),
    ['standard', 'ptc', 'minimal', 'cordis'],
  )
  assert.deepEqual(
    MODES.map((mode) => mode.label),
    ['标准模式', 'PTC 模式', '极简模式', '创造模式'],
  )
  assert.equal(DEFAULT_MODE, 'standard')

  const ids = async (mode) => (await loadTemplate(mode)).plugins.map((row) => row.id)
  const standard = await ids('standard')

// 每种模式与 standard 的差异必须与部署自己的 patch 文件一致 —— 这条能抓住从错文件刷新的夹具。
  assert.equal((await ids('ptc')).includes('tool-presentation'), true)
  assert.equal(standard.includes('tool-presentation'), false)
  assert.equal((await ids('cordis')).includes('tool-cordis'), true)
  assert.equal(standard.includes('tool-cordis'), false)
  assert.deepEqual(await ids('minimal'), ['persona', 'persistent-shell'])
})

test('normalizeMode keeps a preset id and coerces only what cannot be one (§5.40)', () => {
  for (const mode of MODES) assert.equal(normalizeMode(mode.id), mode.id)
// roster 属于部署，所以这个构建不发的 id 也是合法模式，不是垃圾。
  assert.equal(normalizeMode('house-style'), 'house-style')
// 仍然强制的只有：表达不了预设 id 的值，以及会爬出预设 id 文件名的值。
  for (const junk of [undefined, null, '', 'has/slash', 'has space', 42, {}]) {
    assert.equal(normalizeMode(junk), 'standard')
  }
  assert.equal(modeLabel('cordis'), '创造模式')
// 这个构建不认识的 id 不能被读成「标准模式」：那等于说角色按一个不是它的模式构建。
  assert.equal(modeLabel('nope'), 'nope')
  assert.equal(shippedLabel('cordis'), '创造模式')
  assert.equal(shippedLabel('nope'), null)
})

test('normalizeRole keeps the mode, and defaults a file that predates it', () => {
  assert.equal(normalizeRole({ id: 'team-a', name: 'A', mode: 'ptc' }).mode, 'ptc')
// 早于四种模式的时代写的角色没有 mode：必须还能载入，按标准模式。
  assert.equal(normalizeRole({ id: 'team-a', name: 'A' }).mode, 'standard')
// 角色可以指名这个构建从没见过的预设，载入不能把它悄悄挪到别的模式；
// 只有连预设 id 都不成立的值才被纠正 —— 这段跑在载入期，抛错会把一个手改文件变成废角色。
  assert.equal(normalizeRole({ id: 'team-a', name: 'A', mode: 'house-style' }).mode, 'house-style')
  assert.equal(normalizeRole({ id: 'team-a', name: 'A', mode: 'spawn!!' }).mode, 'standard')
})

test('createRole records the mode it was built from', async () => {
  const ptc = await loadTemplate('ptc')
  const role = createRole('team-architect', '架构师', ptc, 'ptc')
  assert.equal(role.mode, 'ptc')
  assert.equal(role.description, '以 PTC 模式 为模板的角色')

// 传了快照却没传模式：得到与那份快照一致的角色，而不是静默错配的一对。
  assert.equal(createRole('team-b', 'B', ptc).mode, 'ptc')
  assert.equal(createRole('team-c', 'C', await loadTemplate()).mode, 'standard')
})

test('buildDefinition composes the snapshot of the role mode', async () => {
  const templates = new Map()
  for (const mode of MODES) templates.set(mode.id, await loadTemplate(mode.id))
  /** The shape `index.js` passes: one cache, keyed by mode. */
  const templateOf = (mode) => templates.get(normalizeMode(mode))

  const minimal = createRole('team-min', '极简', templates.get('minimal'), 'minimal')
  const composed = buildDefinition(minimal, templateOf, 'win32')
  assert.deepEqual(
    composed.plugins.map((row) => row.id),
    ['persona', 'persistent-shell'],
  )

// 同一个角色、同一批 override 搬到标准模式：行来自另一份快照，minimal-only 行消失。
  const moved = buildDefinition({ ...minimal, mode: 'standard' }, templateOf, 'win32')
  assert.equal(moved.plugins.length, templates.get('standard').plugins.length)
  assert.equal(moved.plugins.some((row) => row.id === 'persistent-shell'), false)

// 模式里没有 agent-instructions 行时，override 保留但没有落点 —— UI 报 agentsMd.hasRow: false，不凭空造行。
  const wired = buildDefinition(
    { ...minimal, overrides: { 'agent-instructions': { config: { dshHome: 'C:\\roles\\team-min' } } } },
    templateOf,
    'win32',
    { dirOf: () => 'C:\\roles\\team-min' },
  )
  assert.equal(wired.plugins.some((row) => row.id === 'agent-instructions'), false)
})

// 颜色是角色文件自己的字段：老角色载入时补写、新角色 upsert 时分配；
// 任意两个角色不同色，同一个 id 永远同一个色。
test('§5.59 normalizeRole keeps a legal colour and drops a broken one', () => {
  const kept = normalizeRole({ id: 'team-a', name: '甲', color: '#1d4ed8' })
  assert.equal(kept.color, '#1D4ED8', '小写要规范化成大写，否则文件永远到不了不动点')

  const dropped = normalizeRole({ id: 'team-a', name: '甲', color: '深紫' })
  assert.equal('color' in dropped, false, '非法颜色不写进文件，留给 RoleStore 补一个')
})

test('§5.59 an old role file gets a colour written back on load', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-colors-'))
  try {
    await mkdir(path.join(dir, 'team-old'), { recursive: true })
    await writeFile(
      path.join(dir, 'team-old', 'role.json'),
      `${JSON.stringify({ id: 'team-old', name: '老角色' }, null, 2)}\n`,
      'utf8',
    )

    const store = new RoleStore(dir)
    await store.load()
    assert.deepEqual(store.colored, ['team-old'], '载入时要把没颜色的角色补上')
    const written = JSON.parse(await readFile(path.join(dir, 'team-old', 'role.json'), 'utf8'))
    assert.match(written.color, /^#[0-9A-F]{6}$/, '颜色必须落盘在角色自己的 role.json 里')

    // 不动点：第二次载入没什么可补的，也不会重写。
    const again = new RoleStore(dir)
    await again.load()
    assert.deepEqual(again.colored, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('§5.59 a new role takes a colour nobody else has', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-colors-'))
  try {
    const store = new RoleStore(dir)
    await store.load()
    const first = await store.upsert({ id: 'team-a', name: '甲' })
    const second = await store.upsert({ id: 'team-b', name: '乙' })

    assert.match(first.color, /^#[0-9A-F]{6}$/)
    assert.notEqual(first.color, second.color, '两个角色不能一个颜色')
    // 编辑一个已有角色不能换掉它的颜色。
    const edited = await store.upsert({ ...first, name: '甲二' })
    assert.equal(edited.color, first.color, '改名字不该改颜色')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('§5.59 nextRoleColor stays deterministic once the palette is full', () => {
  const roles = ROLE_PALETTE.map((color, index) => ({ id: `team-${index}`, color }))
  assert.equal(nextRoleColor(roles, 'team-new'), colorForRoleId('team-new'), '调色板用满后退回稳定散列')
  assert.equal(colorForRoleId('team-new'), colorForRoleId('team-new'), '同名同色，不随角色表变化')
})
