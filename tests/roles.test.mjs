// 行数已经审批
/**
 * Tests for the pure composition layer and the role store.
 *
 * Everything here runs against the bundled snapshots — the `standard` one by
 * default, the other three modes where the mode switch is what is being tested —
 * so the suite also doubles as an assertion that all four are present,
 * parseable, and still have the shape the UI expects.
 */
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

/**
 * 出厂模式的顶层行（**测试夹具**）。
 *
 * §5.62 起插件不再自带快照：运行时从部署的 Loader 读预设声明，测试里没有部署，
 * 于是那四份声明放在 `tests/fixtures/presets/`。夹具停在抽取那天不影响这些断言：
 * 它们问的是「这份组合怎么被用」，不是「dsh 今天发了哪些行」。
 */
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

// The user's model is 「agents.md 就是身份描述和一些规则」 (m05741): a row whose
// whole job is a line of the identity prompt is not a dimension of its own, so
// `persona` shares the AGENTS.md group and no `identity` key exists any more.
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

  // Roles address their overrides by *bare row id*, not by the `parent/child`
  // path the UI displays, so a duplicate id would make two rows share one
  // override. The snapshot is generated, so this asserts the generator's output
  // rather than trusting it.
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

// §5.53 — a role composition keeps `modelSelectionSettings: true` on
// `dsh-tool-subagent`. The member is rebound to the role preset **inside the creation
// window**, before its parent's `preset-standard` standing listener could install its
// own copy, so `list_subagent_models` (a globally named tool, 「每个工具作用域内最多
// 一个实例可以拥有模型选择」) has exactly one owner again.
//
// §5.52 used to defuse this flag at composition time because a member joined its
// parent's preset first and dsh then refused the member with
//   tool "list_subagent_models" is already registered in this scope
// That cure cost every role member the sub-model catalog and the `subagent` tool's
// `provider`/`model`/`reasoning_effort` arguments, so it is gone (§5.53).
test('composeRows keeps the globally named subagent catalog (§5.53)', async () => {
  const template = await loadTemplate()
  const raw = template.plugins
    .find((row) => row.id === 'delegation')
    .config.find((row) => row.id === 'tool-subagent')

  // The snapshot records what the deployment shipped …
  assert.equal(raw.config.modelSelectionSettings, true)

  const delegation = composeRows(template.plugins, 'win32').find((row) => row.id === 'delegation')
  const subagent = delegation.config.find((row) => row.id === 'tool-subagent')

  // … and the composition leaves it alone, so a role member gets the same catalog as
  // an official subagent. Everything else about the row still survives.
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
  // `isolate` is a group-only declaration, and the UI reads it: the group header
  // says which services run in a realm of their own. Children carry none.
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

    // A save triggered by *another* role must not erase them: the file has to be
    // a fixpoint, otherwise every load-and-write silently rewrites the document.
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

    // The role is a file of its own now — the index holds settings only, which
    // is what makes "每个角色一个 json" true rather than cosmetic (§5.29).
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

  // `null` is applyConfig's "drop the key", i.e. "inherit the deployment's
  // ~/.dsh". It names no directory, so it is not a deliberate choice of
  // *somewhere else* — and letting it win injects the role's AGENTS.md twice,
  // because the role directory lives under ~/.dsh and the upstream dedup only
  // collapses files from the *same* directory
  // (`…/dsh-agent-instructions/lib/index.js:632`).
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

  // The row already existed in the snapshot; the role only adds `dshHome` to its
  // config, which is what makes `dsh-agent-instructions` load `<roleDir>/AGENTS.md`
  // whatever directory the task runs in (verified against the real package:
  // `discoverBaselineInstructionFiles` returns it as `$DSH_HOME/AGENTS.md`).
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

  // 「上下文是否继承主会话」 is one config key on a row the template already
  // ships — the switch adds no row and renames no tool (user m07236:
  // 「用现成的方式实现就行」).
  role.overrides = { 'tool-subagent': { config: { provider: 'fork' } } }
  const inherit = buildDefinition(role, template, 'win32')
  assert.equal(subagent(inherit).config.provider, 'fork')
  assert.equal(subagent(inherit).config.toolName, 'subagent')
  // The fork tool is a separate, untouched row, and the group keeps its size.
  assert.equal(delegation(inherit).some((row) => row.id === 'tool-subagent-fork'), true)
  assert.equal(delegation(inherit).length, delegation(fresh).length)
})

// §5.32 — the four modes. The user asked for 「loop 直接从现有的四个来选，默认使用标准
// 模式」 (m07307) and then settled where the switch lives: 「角色详情里加一个四选一」
// (m07345). A role therefore stores *which* deployment preset it is built from, and
// its rows come from that preset's declaration (§5.62: read live, no bundled copy).

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

  // Each mode differs from `standard` in exactly the way the deployment's own
  // patch file says it does — this is the assertion that catches a fixture
  // refreshed from the wrong file.
  assert.equal((await ids('ptc')).includes('tool-presentation'), true)
  assert.equal(standard.includes('tool-presentation'), false)
  assert.equal((await ids('cordis')).includes('tool-cordis'), true)
  assert.equal(standard.includes('tool-cordis'), false)
  assert.deepEqual(await ids('minimal'), ['persona', 'persistent-shell'])
})

test('normalizeMode keeps a preset id and coerces only what cannot be one (§5.40)', () => {
  for (const mode of MODES) assert.equal(normalizeMode(mode.id), mode.id)
  // §5.40 — the roster belongs to the deployment, so an id this build does not
  // ship is a legitimate mode, not junk.
  assert.equal(normalizeMode('house-style'), 'house-style')
  // What is still coerced: nothing that could not name a preset, and nothing
  // that could climb out of a preset id used as a file-name component.
  for (const junk of [undefined, null, '', 'has/slash', 'has space', 42, {}]) {
    assert.equal(normalizeMode(junk), 'standard')
  }
  assert.equal(modeLabel('cordis'), '创造模式')
  // An id this build does not know must not read as 「标准模式」: that would
  // name a mode the role is not built from.
  assert.equal(modeLabel('nope'), 'nope')
  assert.equal(shippedLabel('cordis'), '创造模式')
  assert.equal(shippedLabel('nope'), null)
})

test('normalizeRole keeps the mode, and defaults a file that predates it', () => {
  assert.equal(normalizeRole({ id: 'team-a', name: 'A', mode: 'ptc' }).mode, 'ptc')
  // A role written before §5.32 has no `mode` at all: it must still load, as
  // standard — the mode the user named as the default.
  assert.equal(normalizeRole({ id: 'team-a', name: 'A' }).mode, 'standard')
  // §5.40 — a role may name a preset this build has never seen, and loading it
  // must not silently move the role to another mode. Only a value that cannot
  // be a preset id is coerced: this runs on load, where throwing would turn a
  // hand-edited file into an unusable role.
  assert.equal(normalizeRole({ id: 'team-a', name: 'A', mode: 'house-style' }).mode, 'house-style')
  assert.equal(normalizeRole({ id: 'team-a', name: 'A', mode: 'spawn!!' }).mode, 'standard')
})

test('createRole records the mode it was built from', async () => {
  const ptc = await loadTemplate('ptc')
  const role = createRole('team-architect', '架构师', ptc, 'ptc')
  assert.equal(role.mode, 'ptc')
  assert.equal(role.description, '以 PTC 模式 为模板的角色')

  // A caller that passes one snapshot but no mode gets a role that agrees with
  // that snapshot instead of a silently mismatched pair.
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

  // The same role, same overrides, moved to 标准模式: the rows come from the
  // other snapshot and the minimal-only rows are gone.
  const moved = buildDefinition({ ...minimal, mode: 'standard' }, templateOf, 'win32')
  assert.equal(moved.plugins.length, templates.get('standard').plugins.length)
  assert.equal(moved.plugins.some((row) => row.id === 'persistent-shell'), false)

  // A role on a mode with no `agent-instructions` row keeps its overrides but
  // has no row for them to land on — the honest state the UI reports as
  // `agentsMd.hasRow: false` rather than inventing a row (R3).
  const wired = buildDefinition(
    { ...minimal, overrides: { 'agent-instructions': { config: { dshHome: 'C:\\roles\\team-min' } } } },
    templateOf,
    'win32',
    { dirOf: () => 'C:\\roles\\team-min' },
  )
  assert.equal(wired.plugins.some((row) => row.id === 'agent-instructions'), false)
})

// §5.59 —— 用户 m00378：「现有角色直接给 json 里面写一个颜色，新角色也是自动写，不用在界面配置
// 里面展示这个配置」。颜色是角色文件自己的字段：老角色在载入时补写，新角色在 upsert 时分配，
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
