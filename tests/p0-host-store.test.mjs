/**
 * 施工批次 A —— P0 宿主半的回归测试（A3 RoleStore 先改内存再落盘）
 *
 * 来源：`tests/p0-host.test.mjs`（468 行，超 400 行红线）。A3 一族自带 `withStore()` /
 * `injectWriteFailure()` 两个夹具，与 A1/A2/A4/A5 不共享可变状态，所以整段搬出来。
 * test() 回调体逐字未改。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { roleDir, roleFile } from '../lib/roleFiles.js'
import { RoleStore } from '../lib/store.js'

/** Does this path exist? Never throws — the answer "no" is the point. */
async function exists(target) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// A3 — RoleStore 先改内存再落盘：写盘一失败，内存与磁盘就分家
// ---------------------------------------------------------------------------

/** Run `run` against a loaded store over a fresh, empty data directory. */
async function withStore(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-roles-p0-store-'))
  const store = new RoleStore(dir)
  await store.load()
  try {
    await run(store, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Fail the next disk write, the way a full disk or a locked file would. */
function injectWriteFailure(target, method, message) {
  const original = target[method]
  target[method] = async () => {
    const failure = new Error(message)
    failure.code = 'EPERM'
    throw failure
  }
  return original
}

test('A3: upsert 写盘失败时内存与磁盘都不变', async () => {
  await withStore(async (store, dir) => {
    injectWriteFailure(store, 'writeRole', '注入的写入失败')
    await assert.rejects(() => store.upsert({ id: 'team-a', name: '甲' }), /注入的写入失败/)
    assert.equal(store.find('team-a'), undefined, '写盘失败后内存里不应出现该角色')
    assert.equal(await exists(roleFile(dir, 'team-a')), false, '磁盘上也不应有 role.json')
  })
})

test('A3: upsert 成功后内存与磁盘一致', async () => {
  await withStore(async (store, dir) => {
    const stored = await store.upsert({ id: 'team-a', name: '甲' })
    assert.equal(store.find('team-a'), stored)
    const onDisk = JSON.parse(await readFile(roleFile(dir, 'team-a'), 'utf8'))
    assert.equal(onDisk.id, 'team-a')
    assert.equal(onDisk.name, '甲')
  })
})

test('A3: rename 写盘失败时内存仍用旧 id，且目录被放回原位', async () => {
  await withStore(async (store, dir) => {
    await store.upsert({ id: 'team-a', name: '甲' })
    injectWriteFailure(store, 'writeRole', '注入的写入失败')
    await assert.rejects(() => store.rename('team-a', 'team-b'), /注入的写入失败/)
    assert.ok(store.find('team-a'), '失败后内存仍应认识旧 id')
    assert.equal(store.find('team-b'), undefined)
    assert.equal(await exists(roleDir(dir, 'team-a')), true, '旧目录应被放回')
    assert.equal(await exists(roleDir(dir, 'team-b')), false)
  })
})

test('A3: remove 删目录失败时内存仍保留该角色', async () => {
  await withStore(async (store, dir) => {
    await store.upsert({ id: 'team-a', name: '甲' })
    injectWriteFailure(store, 'deleteRoleDirOf', '注入的删除失败')
    await assert.rejects(() => store.remove('team-a'), /注入的删除失败/)
    assert.ok(store.find('team-a'), '删除失败后内存仍应保留该角色')
    assert.equal(await exists(roleFile(dir, 'team-a')), true)
  })
})

test('A3-followup: 写盘失败不会留下 role.json.tmp', async () => {
  await withStore(async (store, dir) => {
    // 制造一次真实的写入失败：目标路径被一个同名目录占住，rename 必然失败。
    await mkdir(roleFile(dir, 'team-a'), { recursive: true })
    await assert.rejects(() => store.upsert({ id: 'team-a', name: '甲' }))
    assert.equal(
      await exists(`${roleFile(dir, 'team-a')}.tmp`),
      false,
      '失败后不应残留 role.json.tmp',
    )
    assert.equal(store.find('team-a'), undefined, '写盘失败后内存里不应出现该角色')
  })
})
