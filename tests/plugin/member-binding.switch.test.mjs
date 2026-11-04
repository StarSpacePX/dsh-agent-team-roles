/** 成员绑定与角色名、绑定开关。
 * 从 tests/plugin.test.mjs 拆分而来（超 400 行红线），测试体只做了 import 路径加深一层的机械调整。 */
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

// 它是文档级设置，必须能从磁盘重新载入后还在。
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
// 磁盘上缺省 = 显示页签：宿主没有明确说不要就挂载，旧 roles.json 继续能用。
    const before = await call(routes, STATE_URL)
    assert.equal(before.json.hideChatTab, false)

    const hidden = await call(routes, COMMAND_URL, 'POST', { action: 'set-hide-chat-tab', enabled: true })
    assert.equal(hidden.json.state.hideChatTab, true)

    const stored = JSON.parse(await readFile(path.join(dir, 'roles.json'), 'utf8'))
    assert.equal(stored.settings.hideChatTab, true)

// 文档级设置必须能重载存活，也要能翻回去。
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
// 被拒的调用不能写入任何东西。
    assert.equal((await call(routes, STATE_URL)).json.hideChatTab, false)
  }, REVIEWER)
})

/** registered 看不出挂载失败：register() 无论定义是否激活都返回 disposer，
 * 失败只体现为注册表 roster 上的 broken 诊断。这个事实留在本地 ——
 * presets.list() 会 await 整个 Host Loader，所以 /state 只报我们自己角色的挂载健康。 */
