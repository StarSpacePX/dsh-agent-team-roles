/**
 * 团队运行时开关与角色挂载（team bundle / §5.54）
 *
 * 来源：`tests/plugin/team-and-config.test.mjs`（745 行，超 400 行红线）。该文件本身是批次 F4
 * 从 `tests/plugin.test.mjs` 拆出来的，本轮按主题缝继续拆成三份：team（团队运行时 + 短缓存 +
 * 角色 JSON 元数据的延迟挂载）/ config（说明书与批量开关）/ modes（模式清单）。
 * test() 回调体逐字未改，只有文件头与 import 面重写。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { TEAM_BUNDLE } from '../../lib/deployment.js'
import { call, withPlugin } from '../support/harness.mjs'
import path from 'node:path'
import { fakeChild, REVIEWER, createMember, withHome, definitionOf, fakePluginManager, STATE_URL, COMMAND_URL, REBUILD_WAIT_MS, sleep } from '../support/plugin-fixtures.mjs'

test('the panel reads the team runtime from the deployment, not from the role store', async () => {
  const manager = fakePluginManager({ enabled: false })
  await withPlugin(
    async ({ routes }) => {
      const state = await call(routes, STATE_URL)
      assert.equal(state.status, 200)
      assert.equal(state.json.team.bundle, TEAM_BUNDLE)
      assert.equal(state.json.team.available, true)
      assert.equal(state.json.team.enabled, false)
      assert.equal(state.json.team.installed, true)
      assert.equal(state.json.team.version, '0.1.7-rc.2')
      assert.equal(state.json.team.readOnlyReason, null)
      // 团队没开，成员绑定也就没开 —— 两个值一起上报，但不是一个值。
      assert.equal(state.json.bindMembers, false)
    },
    { version: 1, roles: [] },
    undefined,
    { pluginManager: manager },
  )
})

test('set-team selects the team bundle and keeps member binding in step', async () => {
  const manager = fakePluginManager({ enabled: false, application: 'restart-required' })
  await withPlugin(
    async ({ routes }, dir) => {
      const on = await call(routes, COMMAND_URL, 'POST', { action: 'set-team', enabled: true })
      assert.equal(on.status, 200)
      assert.equal(on.json.result.changed, true)
      assert.equal(on.json.result.application, 'restart-required')
      assert.equal(on.json.result.applicationLabel, '已保存，重启 dsh 后生效')
      assert.equal(on.json.state.team.enabled, true)
      assert.equal(on.json.state.bindMembers, true)
      assert.deepEqual(manager.calls, [{ name: TEAM_BUNDLE, enabled: true }])

      // The member-binding switch is a document setting, so it survives a reload
      // — and it is what makes the roles reachable once the runtime is up.
      const document = JSON.parse(await readFile(path.join(dir, 'roles.json'), 'utf8'))
      assert.equal(document.settings.bindMembers, true)

      const off = await call(routes, COMMAND_URL, 'POST', { action: 'set-team', enabled: false })
      assert.equal(off.status, 200)
      assert.equal(off.json.state.team.enabled, false)
      assert.equal(off.json.state.bindMembers, false)
      assert.deepEqual(manager.calls, [
        { name: TEAM_BUNDLE, enabled: true },
        { name: TEAM_BUNDLE, enabled: false },
      ])

      const bad = await call(routes, COMMAND_URL, 'POST', { action: 'set-team', enabled: 'yes' })
      assert.equal(bad.status, 400)
      assert.match(bad.json.error, /set-team 需要 enabled 布尔值/)
    },
    { version: 1, roles: [] },
    undefined,
    { pluginManager: manager },
  )
})

test('a profile whose manager refuses the bundle says why instead of looking off', async () => {
  const locked = fakePluginManager({ enabled: false, readOnlyReason: 'bundle-in-use' })
  await withPlugin(
    async ({ routes }) => {
      const state = await call(routes, STATE_URL)
      assert.equal(state.json.team.available, true)
      assert.equal(state.json.team.enabled, false)
      assert.equal(state.json.team.readOnlyReason, 'bundle-in-use')

      const refused = await call(routes, COMMAND_URL, 'POST', { action: 'set-team', enabled: true })
      assert.equal(refused.status, 400)
      assert.match(refused.json.error, /profile 组合不可改：bundle-in-use/)
      assert.deepEqual(locked.calls, [], 'a refused toggle never reaches the manager')
    },
    { version: 1, roles: [] },
    undefined,
    { pluginManager: locked },
  )

  // A manager that reports a failed change keeps that failure in the response.
  const failing = fakePluginManager({ enabled: false, error: { code: 'operation-error', diagnostic: 'pnpm 拒绝' } })
  await withPlugin(
    async ({ routes }) => {
      const failed = await call(routes, COMMAND_URL, 'POST', { action: 'set-team', enabled: true })
      assert.equal(failed.status, 200)
      assert.equal(failed.json.result.application, 'failed')
      assert.equal(failed.json.result.error, 'pnpm 拒绝')
    },
    { version: 1, roles: [] },
    undefined,
    { pluginManager: failing },
  )
})

test('without a plugin manager the switch explains itself and refuses the click', async () => {
  await withPlugin(async ({ routes }) => {
    const state = await call(routes, STATE_URL)
    assert.equal(state.json.team.available, false)
    assert.equal(state.json.team.bundle, TEAM_BUNDLE)
    assert.match(state.json.team.reason, /pluginManager/)

    const refused = await call(routes, COMMAND_URL, 'POST', { action: 'set-team', enabled: true })
    assert.equal(refused.status, 400)
    assert.match(refused.json.error, /pluginManager/)
  })
})

//#region §5.54 — 部署组合清单的短缓存

test('§5.54 consecutive state reads ask the deployment for its bundles once', async () => {
  const manager = fakePluginManager({ enabled: true })
  await withPlugin(
    async ({ routes }) => {
      const first = await call(routes, STATE_URL)
      assert.equal(first.json.team.enabled, true)
      const asked = manager.listCalls
      assert.equal(asked, 1, '一次读状态只问一次部署组合清单')

      const second = await call(routes, STATE_URL)
      assert.equal(second.json.team.enabled, true)
      assert.equal(manager.listCalls, asked, '3 秒内的第二次读状态不再问部署（§5.54 缓存）')
    },
    { version: 1, roles: [] },
    undefined,
    { pluginManager: manager },
  )
})

test('§5.54 toggling the team patches the cached roster instead of re-reading it', async () => {
  const manager = fakePluginManager({ enabled: false, application: 'restart-required' })
  await withPlugin(
    async ({ routes }) => {
      const before = await call(routes, STATE_URL)
      assert.equal(before.json.team.enabled, false)
      const asked = manager.listCalls

      const on = await call(routes, COMMAND_URL, 'POST', { action: 'set-team', enabled: true })
      assert.equal(on.status, 200)
      // 回包里就是新值：toggle 自己改了缓存里那一位，否则面板会把自己刚做的改动读成旧值。
      assert.equal(on.json.state.team.enabled, true)
      assert.equal(manager.listCalls, asked, '翻开关不再重读那份 1.2 秒的组合清单（§5.54）')

      // 「重载」才是明确要求重读的动作：那一次真的问一遍部署。
      const reload = await call(routes, COMMAND_URL, 'POST', { action: 'reload' })
      assert.equal(reload.status, 200)
      assert.equal(reload.json.state.team.enabled, true)
      assert.ok(manager.listCalls > asked, '「重载」之后必须重新问一次部署')
    },
    { version: 1, roles: [] },
    undefined,
    { pluginManager: manager },
  )
})

//#endregion §5.54

//#region §5.54 — 角色 JSON 是元数据：写配置只落盘，角色 preset 用到才构建

/**
 * 用户的原话是「把 json 变更/加载当成数据库元数据加载」。修复前写配置这条路会
 * `await sync(presets)`：拆掉并重挂每个角色（`register()` 就是挂载一整棵树），
 * 而 `/state` 还跑 `presets.list()` —— 它在有 pending 行时会等整个 Host Loader
 * （`…\dsh-agent-preset-registry\lib\index.js:557-568`），实测一次勾选 10778 ms。
 * 现在写路径只落盘 + 标「待挂载」，构建留给后台重建或真正用到的时刻。
 */

test('§5.54 a config write answers before anything is registered or diagnosed', async () => {
  await withHome(async (home) => {
    await withPlugin(
      async ({ routes, registryState }) => {
        // 先热一次名册缓存：真实使用里 `/state` 会被反复调用（面板轮询），模式清单
        // 是缓存的元数据；一次勾选不该为它再读一次注册表。
        await call(routes, STATE_URL)
        const lists = registryState.listCalls
        const registers = registryState.registerCalls

        const write = await call(
          routes,
          COMMAND_URL,
          'POST',
          { action: 'set-skills', id: 'team-architect', mode: 'pick', ids: [] },
          undefined,
          { nowait: true },
        )

        assert.equal(write.status, 200)
        assert.deepEqual(write.json.result.applied, [])
        assert.deepEqual(write.json.result.deferred, ['team-architect'])
        assert.match(write.json.result.deferredReason, /改完即存/)
        // 注册表这一轮既没被读、也没被写：毫秒回包的全部秘密就在这里。
        assert.equal(registryState.listCalls, lists)
        assert.equal(registryState.registerCalls, registers)
        // 旧挂载还在服务（mounted），新定义排队等重建（deferred）。
        assert.deepEqual(write.json.state.mounted, ['team-architect'])
        assert.deepEqual(write.json.state.deferred, ['team-architect'])

        // 回包之后后台重建只把改过的那一个角色挂上，并补一次健康诊断。
        await sleep(REBUILD_WAIT_MS)
        assert.equal(registryState.registerCalls, registers + 1)
        assert.ok(registryState.listCalls > lists, '重建之后要重新诊断挂载健康')
        const state = await call(routes, STATE_URL)
        assert.deepEqual(state.json.deferred, [])
        assert.deepEqual(state.json.registry, [{ id: 'team-architect' }])
      },
      {
        version: 1,
        roles: [{ id: 'team-architect', name: '架构师', description: '', order: 10, overrides: {} }],
      },
      { home },
    )
  })
})

test('§5.54 re-syncing unchanged roles does not re-mount them', async () => {
  await withHome(async (home) => {
    await withPlugin(
      async ({ routes, registryState }) => {
        const registers = registryState.registerCalls
        const again = await call(routes, COMMAND_URL, 'POST', { action: 'sync' })
        assert.equal(again.status, 200)
        assert.deepEqual(again.json.result.applied, [])
        assert.deepEqual(again.json.state.deferred, [])
        assert.equal(registryState.registerCalls, registers, '指纹没变就不该重挂')
      },
      {
        version: 1,
        roles: [{ id: 'team-architect', name: '架构师', description: '', order: 10, overrides: {} }],
      },
      { home },
    )
  })
})

test('§5.54 a member creation mounts the deferred role before selecting it', async () => {
  await withPlugin(
    async (harness) => {
      const { routes, registryState, selected } = harness
      // 改一次配置但不等待重建，让这个角色的挂载落后于 JSON。
      const write = await call(
        routes,
        COMMAND_URL,
        'POST',
        { action: 'set-skills', id: 'team-reviewer', mode: 'pick', ids: ['xlsx'] },
        undefined,
        { nowait: true },
      )
      assert.deepEqual(write.json.result.deferred, ['team-reviewer'])
      const registers = registryState.registerCalls

      // 创建窗口里必须先把它挂上：注册表的 `retain()` 对未登记的 id 抛
      // `agent-preset/not-found`，整条成员创建都会回滚。
      await createMember(harness, { child: fakeChild('reviewer') })
      assert.ok(registryState.registerCalls > registers, '创建窗口按需挂载了这个角色')
      assert.deepEqual(selected.map((entry) => entry.preset), ['team-reviewer'])

      const state = await call(routes, STATE_URL)
      assert.deepEqual(state.json.deferred, [], '按需挂载之后就不再是待挂载状态')
    },
    REVIEWER,
    { bindMembers: true },
    { agents: true },
  )
})

//#endregion §5.54
