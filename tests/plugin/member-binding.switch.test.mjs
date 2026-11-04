/**
 * 成员绑定与角色名（§5.46 / §5.53 / 绑定开关）
 *
 * 批次 F4：从 tests/plugin.test.mjs 拆分而来。test() 回调体逐字未改，只有两类机械调整：
 * import 来源换成本目录的相对路径；测试体里 `new URL('../lib/…')` 加深一层为 `'../../lib/…'`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { memberNameForRole, roleForMemberName } from '../../lib/roles.js'
import { ROSTER_ROLE_LINE, rosterText } from '../../lib/team-roster.js'
import { call, withPlugin } from '../support/harness.mjs'
import path from 'node:path'
import { fakeChild, REVIEWER, LEAD_AGENT, createMember, CHINESE_ROLE, STATE_URL, COMMAND_URL } from '../support/plugin-fixtures.mjs'


test('set-bind-members persists a document-level switch the UI can flip', async () => {
  await withPlugin(async ({ routes }) => {
    const before = await call(routes, STATE_URL)
    assert.equal(before.json.bindMembers, false)
    assert.equal(before.json.bindMembersSource, 'off')

    const flipped = await call(routes, COMMAND_URL, 'POST', { action: 'set-bind-members', enabled: true })
    assert.equal(flipped.json.state.bindMembers, true)
    assert.equal(flipped.json.state.bindMembersSource, 'store')

    // It is a document setting, so it must survive a reload from disk.
    const reloaded = await call(routes, COMMAND_URL, 'POST', { action: 'reload' })
    assert.equal(reloaded.json.state.bindMembers, true)
  }, REVIEWER)
})

test('the document switch turns binding on with no plugin restart', async () => {
  await withPlugin(
    async (harness) => {
      const { routes, selected } = harness
      await createMember(harness, { child: fakeChild('reviewer') })
      assert.deepEqual(selected, [], 'binding starts off')

      await call(routes, COMMAND_URL, 'POST', { action: 'set-bind-members', enabled: true })
      await createMember(harness, { child: fakeChild('reviewer') })
      assert.deepEqual(
        selected.map((entry) => entry.preset),
        ['team-reviewer'],
      )

      await call(routes, COMMAND_URL, 'POST', { action: 'set-bind-members', enabled: false })
      await createMember(harness, { child: fakeChild('reviewer') })
      assert.equal(selected.length, 1, 'turning it back off stops new bindings')
    },
    REVIEWER,
    undefined,
    { agents: true },
  )
})

test('the plugin config forces binding on, and reports itself as the source', async () => {
  await withPlugin(
    async (harness) => {
      const { routes, selected } = harness
      const state = await call(routes, STATE_URL)
      assert.equal(state.json.bindMembers, true)
      assert.equal(state.json.bindMembersSource, 'config')

      await call(routes, COMMAND_URL, 'POST', { action: 'set-bind-members', enabled: false })
      const after = await call(routes, STATE_URL)
      assert.equal(after.json.bindMembers, true, 'the config cannot be turned off from the UI')

      await createMember(harness, { child: fakeChild('reviewer') })
      assert.deepEqual(
        selected.map((entry) => entry.preset),
        ['team-reviewer'],
      )
    },
    REVIEWER,
    { bindMembers: true },
    { agents: true },
  )
})

test('set-bind-members rejects a missing or non-boolean flag', async () => {
  await withPlugin(async ({ routes }) => {
    assert.equal((await call(routes, COMMAND_URL, 'POST', { action: 'set-bind-members' })).status, 400)
    assert.equal(
      (await call(routes, COMMAND_URL, 'POST', { action: 'set-bind-members', enabled: 'yes' })).status,
      400,
    )
  }, REVIEWER)
})

test('set-hide-chat-tab persists the R6 switch, defaulting to "shown"', async () => {
  await withPlugin(async ({ routes }, dir) => {
    // Absent from disk means "show the tab": the client mounts it unless the
    // host explicitly says otherwise, so an older roles.json keeps working.
    const before = await call(routes, STATE_URL)
    assert.equal(before.json.hideChatTab, false)

    const hidden = await call(routes, COMMAND_URL, 'POST', { action: 'set-hide-chat-tab', enabled: true })
    assert.equal(hidden.json.state.hideChatTab, true)

    const stored = JSON.parse(await readFile(path.join(dir, 'roles.json'), 'utf8'))
    assert.equal(stored.settings.hideChatTab, true)

    // A document setting must survive a reload from disk, and be flippable back.
    const reloaded = await call(routes, COMMAND_URL, 'POST', { action: 'reload' })
    assert.equal(reloaded.json.state.hideChatTab, true)
    const shown = await call(routes, COMMAND_URL, 'POST', { action: 'set-hide-chat-tab', enabled: false })
    assert.equal(shown.json.state.hideChatTab, false)
    assert.equal((await call(routes, STATE_URL)).json.hideChatTab, false)
  }, REVIEWER)
})

test('set-hide-chat-tab rejects a missing or non-boolean flag', async () => {
  await withPlugin(async ({ routes }) => {
    assert.equal((await call(routes, COMMAND_URL, 'POST', { action: 'set-hide-chat-tab' })).status, 400)
    assert.equal(
      (await call(routes, COMMAND_URL, 'POST', { action: 'set-hide-chat-tab', enabled: 'yes' })).status,
      400,
    )
    // The refused calls must not have written anything.
    assert.equal((await call(routes, STATE_URL)).json.hideChatTab, false)
  }, REVIEWER)
})

/**
 * `registered` cannot show a mount failure: `register()` resolves with a disposer
 * whether or not the definition activated, and reports the failure as a `broken`
 * diagnostic on the registry's roster instead. §5.54 keeps that fact local — the
 * roster read (`presets.list()`) awaits the whole Host Loader while any row is
 * pending, so `/state` reports the mount health of *our* roles instead.
 */
