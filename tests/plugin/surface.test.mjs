/**
 * 插件装配与 HTTP 面
 *
 * 批次 F4：从 tests/plugin.test.mjs 拆分而来。test() 回调体逐字未改，只有两类机械调整：
 * import 来源换成本目录的相对路径；测试体里 `new URL('../lib/…')` 加深一层为 `'../../lib/…'`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { apply } from '../../lib/index.js'
import { createHarness, settle, call, withPlugin } from '../support/harness.mjs'
import os from 'node:os'
import path from 'node:path'
import { STATE_URL, COMMAND_URL, TEAM_LOG_URL, BASH_DISABLED_ON, expectedBashDisabled } from '../support/plugin-fixtures.mjs'

test('apply registers one preset per stored role', async () => {
  await withPlugin(
    async ({ registered, routes }) => {
      assert.deepEqual(
        registered.map((record) => record.id),
        ['team-architect'],
      )

      const definition = registered[0].definition
      assert.equal(definition.name, '架构师')
      // §7 F3 — 期望值来自 BASH_DISABLED_ON 这张表，不是实现里的 platform 表达式。
      assert.equal(definition.plugins.find((row) => row.id === 'tool-bash').disabled, expectedBashDisabled())

      const state = await call(routes, STATE_URL)
      assert.equal(state.status, 200)
      assert.equal(state.json.registered.includes('team-architect'), true)
      assert.ok(state.json.roles[0].rows.length > 10)

      // Exactly the three exact-match routes the client fetches, nothing else.
      assert.deepEqual(
        [...routes.keys()].sort(),
        [`exact ${COMMAND_URL}`, `exact ${STATE_URL}`, `exact ${TEAM_LOG_URL}`],
      )
    },
    {
      version: 1,
      roles: [{ id: 'team-architect', name: '架构师', description: '', order: 10, overrides: {} }],
    },
  )
})

test('a profile without a web server still registers roles and opens no route', async () => {
  await withPlugin(
    async ({ registered, routes, log, pending }) => {
      assert.deepEqual(
        registered.map((record) => record.id),
        ['team-architect'],
      )
      assert.equal(routes.size, 0)
      // The route callback is left waiting exactly as Cordis leaves it.
      assert.equal(
        pending.some((entry) => entry.dependencies.includes('webServer')),
        true,
      )
      assert.equal(
        log.some((entry) => entry.level === 'error'),
        false,
      )
      assert.ok(log.some((entry) => entry.message.includes('agent team 角色已就绪')))
    },
    {
      version: 1,
      roles: [{ id: 'team-architect', name: '架构师', description: '', order: 10, overrides: {} }],
    },
    undefined,
    { omitServices: ['webServer'] },
  )
})

test('the HTTP surface creates, edits and deletes roles', async () => {
  await withPlugin(async ({ registered, routes }) => {
    const created = await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })
    assert.equal(created.status, 200)
    assert.equal(created.json.id, 'team-reviewer')
    assert.deepEqual(
      created.json.state.roles.map((role) => role.id),
      ['team-reviewer'],
    )

    const overridden = await call(routes, COMMAND_URL, 'POST', {
      action: 'set-override',
      id: 'team-reviewer',
      row: 'tool-bash',
      disabled: false,
    })
    assert.equal(overridden.status, 200)

    const row = overridden.json.state.roles[0].rows.find((entry) => entry.id === 'tool-bash')
    assert.equal(row.disabled, false)
    assert.equal(row.hasOverride, true)
    // Re-registering is how an edit takes effect: the old mount is gone.
    assert.equal(registered.filter((record) => record.id === 'team-reviewer' && !record.disposed).length, 1)

    const cleared = await call(routes, COMMAND_URL, 'POST', {
      action: 'clear-override',
      id: 'team-reviewer',
      row: 'tool-bash',
    })
    const clearedRow = cleared.json.state.roles[0].rows.find((entry) => entry.id === 'tool-bash')
    assert.equal(clearedRow.hasOverride, false)
    // §7 F3 — 同上：清掉 override 后回落到模板的门，期望值走常量表。
    assert.equal(clearedRow.disabled, expectedBashDisabled())

    const deleted = await call(routes, COMMAND_URL, 'POST', { action: 'delete-role', id: 'team-reviewer' })
    assert.equal(deleted.json.state.roles.length, 0)
    assert.equal(registered.every((record) => record.disposed), true)
  })
})

test('an unknown action is a 400, not a crash', async () => {
  await withPlugin(async ({ routes }) => {
    const response = await call(routes, COMMAND_URL, 'POST', { action: 'nope' })
    assert.equal(response.status, 400)
    assert.match(response.json.error, /未知操作/)
  })
})

test('a GET to the command route is refused', async () => {
  await withPlugin(async ({ routes }) => {
    const response = await call(routes, COMMAND_URL, 'GET')
    assert.equal(response.status, 405)
  })
})

test('clearConfig drops an overridden key, and an emptied entry with it', async () => {
  await withPlugin(async ({ routes }) => {
    await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })

    const written = await call(routes, COMMAND_URL, 'POST', {
      action: 'set-override',
      id: 'team-reviewer',
      row: 'agent-instructions',
      config: { instructionFileCandidates: ['AGENTS.md', 'TEAM.md'] },
    })
    const writtenRow = written.json.state.roles[0].rows.find((entry) => entry.id === 'agent-instructions')
    assert.deepEqual(writtenRow.config.instructionFileCandidates, ['AGENTS.md', 'TEAM.md'])
    assert.equal(writtenRow.hasOverride, true)

    const cleared = await call(routes, COMMAND_URL, 'POST', {
      action: 'set-override',
      id: 'team-reviewer',
      row: 'agent-instructions',
      // Both spellings travel together: `null` for hosts that predate
      // `clearConfig`, which is what actually removes the key here.
      config: { instructionFileCandidates: null },
      clearConfig: ['instructionFileCandidates'],
    })
    const role = cleared.json.state.roles[0]
    const clearedRow = role.rows.find((entry) => entry.id === 'agent-instructions')
    assert.equal(role.overrides['agent-instructions'], undefined)
    assert.equal(clearedRow.hasOverride, false)
    // Back to the template value: the snapshot only sets `maxBytes` here.
    assert.deepEqual(clearedRow.config, clearedRow.templateConfig)
    assert.equal(clearedRow.config.instructionFileCandidates, undefined)
  })
})

test('clearConfig leaves sibling overrides alone', async () => {
  await withPlugin(async ({ routes }) => {
    await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })
    await call(routes, COMMAND_URL, 'POST', {
      action: 'set-override',
      id: 'team-reviewer',
      row: 'agent-instructions',
      disabled: true,
      config: { instructionFileCandidates: ['AGENTS.md', 'TEAM.md'], projectRootMarkers: ['.git'] },
    })

    const cleared = await call(routes, COMMAND_URL, 'POST', {
      action: 'set-override',
      id: 'team-reviewer',
      row: 'agent-instructions',
      config: { instructionFileCandidates: null },
      clearConfig: ['instructionFileCandidates'],
    })
    const role = cleared.json.state.roles[0]
    assert.deepEqual(role.overrides['agent-instructions'], {
      disabled: true,
      config: { projectRootMarkers: ['.git'] },
    })
  })
})

test('disposing the plugin unregisters every preset', async () => {
  await withPlugin(
    async ({ effects, registered }) => {
      assert.equal(registered.filter((record) => !record.disposed).length, 1)

      const presetEffect = effects.find((effect) => effect.label === 'agent-team-roles: presets')
      assert.ok(presetEffect)
      await presetEffect.dispose()

      assert.equal(registered.every((record) => record.disposed), true)
    },
    { version: 1, roles: [{ id: 'team-a', name: 'A', description: '', order: 10, overrides: {} }] },
  )
})

test('a broken roles file is reported instead of taking the plugin down', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-roles-broken-'))
  await writeFile(path.join(dir, 'roles.json'), '{ not json', 'utf8')
  const harness = createHarness()
  try {
    apply(harness.ctx, { dir })
    await settle(harness.log)

    assert.equal(harness.registered.length, 0)
    assert.ok(harness.log.some((entry) => entry.level === 'error' && entry.message.includes('初始化失败')))

    const state = await call(harness.routes, STATE_URL)
    assert.equal(state.status, 200)
    assert.ok(state.json.error)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/**
 * A member's own descriptor label is what names its role, and `agent/created` is
 * the only window in which that binding can still be made: the registry refuses a
 * session that has already started.
 */

