/**
 * 施工批次 A —— P0 宿主半的回归测试（A4 /command 全 400 且无日志 / A5 dispose 竞态）
 *
 * 来源：`tests/p0-host.test.mjs`（468 行，超 400 行红线）。这两节共享 `createHarness()` 与
 * `waitFor()`，与 A1/A2/A3 的临时数据目录夹具没有交集，所以整段搬出来。
 * test() 回调体逐字未改。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { apply, commandStatus, notReady, stateAfterWrite } from '../lib/index.js'
import { notesPath } from '../lib/notes.js'
import { createHarness, call, withPlugin } from './support/harness.mjs'

const COMMAND_URL = '/api/dsh-agent-team-roles/command'

// ---------------------------------------------------------------------------
// A4 — /command 全 400 且无日志
// ---------------------------------------------------------------------------

test('A4: commandStatus 用错误自带的 status，未就绪回 503，其余回 400', () => {
  assert.equal(commandStatus(new Error('随便什么错')), 400, '没有 status 的错误仍是 400')
  assert.equal(commandStatus({ status: 409 }), 409, '自带 status 的错误要用它')
  assert.equal(commandStatus(notReady('agentPresets 服务尚未就绪')), 503, '未就绪是 503')
  assert.equal(commandStatus(notReady('随便')), 503)
  assert.equal(commandStatus({ status: 200 }), 400, '不是错误的状态码不当错误码用')
  assert.equal(commandStatus({ status: 700 }), 400)
  assert.equal(commandStatus(null), 400)
  assert.equal(notReady('x').code, 'NOT_READY')
})

test('A4: stateAfterWrite 失败时把错误写进 state 而不是抛出去', async () => {
  const warned = []
  const fallback = { roles: [], loaded: true }
  const state = await stateAfterWrite(
    async () => {
      throw new Error('读盘炸了')
    },
    { fallback, warn: (message) => warned.push(message) },
  )
  assert.match(String(state.error), /命令已生效/)
  assert.match(String(state.error), /读盘炸了/)
  assert.equal(state.loaded, true, '回退状态应被合并进来')
  assert.deepEqual(state.roles, [])
  assert.equal(warned.length, 1, '失败要记一条日志')
  assert.match(warned[0], /命令已生效/)
})

test('A4: stateAfterWrite 没有回退状态时只回 error', async () => {
  const state = await stateAfterWrite(async () => {
    throw new Error('还是没有')
  })
  assert.deepEqual(Object.keys(state), ['error'])
})

test('A4: stateAfterWrite 成功时原样返回 build 的结果，且不记日志', async () => {
  const warned = []
  const built = { roles: [{ id: 'team-a' }] }
  const state = await stateAfterWrite(async () => built, { warn: (m) => warned.push(m) })
  assert.equal(state, built)
  assert.equal(warned.length, 0)
})

test('A4: 坏 notes.json 时 export-notes 回 409 且留下 warn 日志', async () => {
  await withPlugin(async (harness, dir) => {
    const file = notesPath(dir)
    await writeFile(file, '{ 这不是 JSON', 'utf8')

    const response = await call(harness.routes, COMMAND_URL, 'POST', { action: 'export-notes' })

    assert.equal(response.status, 409, '拒绝覆盖用户文件是 409，不是 400')
    assert.match(String(response.json.error), /不是合法 JSON/)
    assert.equal(await readFile(file, 'utf8'), '{ 这不是 JSON', '原文件必须一字不改')

    const warned = harness.log.filter((entry) => entry.level === 'warn')
    assert.ok(
      warned.some((entry) => /command export-notes/.test(String(entry.message))),
      `应有一条带 action 名的 warn 日志，实际：${JSON.stringify(harness.log)}`,
    )
  })
})

test('A4: 普通拒绝回 400 但也有 warn 日志（路由不再是哑的）', async () => {
  await withPlugin(async (harness) => {
    const response = await call(harness.routes, COMMAND_URL, 'POST', { action: '没有这个动作' })

    assert.equal(response.status, 400)
    const warned = harness.log.filter((entry) => entry.level === 'warn')
    assert.ok(
      warned.some((entry) => /command 没有这个动作/.test(String(entry.message))),
      `拒绝也要留日志，实际：${JSON.stringify(harness.log)}`,
    )
  })
})

// ---------------------------------------------------------------------------
// A5 — dispose 与「还在注册中的角色」赛跑
// ---------------------------------------------------------------------------

/** Poll until `predicate` holds; the plugin's startup is fire-and-forget. */
async function waitFor(predicate) {
  for (let turn = 0; turn < 1000; turn += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, turn < 20 ? 0 : 2))
  }
  throw new Error('条件始终没有成立')
}

test('A5: 卸载后才拿到句柄的 preset 被当场释放，不会留在注册表里', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-roles-p0-a5-'))
  await writeFile(
    path.join(dir, 'roles.json'),
    JSON.stringify({
      version: 1,
      roles: [{ id: 'team-slow', name: '慢角色', description: '', order: 10, overrides: {} }],
    }),
    'utf8',
  )

  const harness = createHarness()
  /** Held until the test lets the registry answer. */
  let answer = () => {}
  const gate = new Promise((resolve) => {
    answer = resolve
  })
  /** @type {string[]} */
  const released = []
  let reached = false
  harness.agentPresets.register = async (definition) => {
    reached = true
    await gate
    return async () => {
      released.push(definition.id)
    }
  }

  try {
    apply(harness.ctx, { dir })
    // 启动流程会先挂所有还没挂的角色，现在它卡在 register() 的 await 上。
    await waitFor(() => reached)

    const effect = harness.effects.find((entry) => entry.label === 'agent-team-roles: presets')
    assert.ok(effect !== undefined, '应能拿到 agentPresets 的副作用句柄')
    await effect.dispose()

    // 注册表现在才回话：句柄到得太晚，没人能再为它负责了。
    answer()
    await waitFor(() => released.length > 0)

    assert.deepEqual(released, ['team-slow'], '晚到的句柄应在发现插件已卸载时被释放')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
