/** P0 宿主半回归测试（A1 路径逃逸 / A2 notes.json 坏 JSON 与复核反例）。
 * 假 Cordis 上下文见 tests/harness.mjs。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { exportNotes, notesPath } from '../lib/notes.js'
import { createAgentsMd, roleDir, roleFile } from '../lib/roleFiles.js'
import { call, withPlugin } from './support/harness.mjs'

const COMMAND_URL = '/api/dsh-agent-team-roles/command'
const STATE_URL = '/api/dsh-agent-team-roles/state'

/** Does this path exist? Never throws — the answer "no" is the point. */
async function exists(target) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

/** Run against a throwaway data directory. */
async function withDataDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-roles-p0-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---- A1 —— 路径逃逸：create-role 先落盘后校验 id ----

test('A1: roleDir 拒绝任何能逃出数据目录的 id', () => {
  const refused = [
    '',
    ' ',
    '.',
    '..',
    '../evil',
    '..\\evil',
    'a/b',
    'a\\b',
    'C:\\x',
    'C:/x',
    '/etc/passwd',
    'con',
    'NUL',
    'team-a.',
    'team-a ',
    ' x',
    'x ',
  ]
  for (const id of refused) {
    assert.throws(
      () => roleDir('C:\\data', id),
      /角色 id/,
      `roleDir 必须拒绝 ${JSON.stringify(id)}`,
    )
  }
})

test('A1: createAgentsMd 不会在数据目录外留下任何文件', async () => {
  await withDataDir(async (dir) => {
    const escaped = path.join(path.dirname(dir), 'p0-escape')
    try {
      await assert.rejects(
        () => createAgentsMd({ dir, id: '../p0-escape' }),
        /角色 id/,
      )
      assert.equal(await exists(escaped), false, '数据目录外不应出现新目录')
      assert.equal(await exists(path.join(escaped, 'AGENTS.md')), false)
    } finally {
      await rm(escaped, { recursive: true, force: true })
    }
  })
})

test('A1: 合法 id 仍然正常写出 AGENTS.md', async () => {
  await withDataDir(async (dir) => {
    const copied = await createAgentsMd({ dir, id: 'team-ok' })
    assert.equal(copied.file, path.join(dir, 'team-ok', 'AGENTS.md'))
    assert.equal(await exists(copied.file), true)
  })
})

test('A1: /command create-role 用 ../ 逃逸时回 4xx 且不写盘', async () => {
  await withPlugin(async ({ routes }, dir) => {
    const escaped = path.join(path.dirname(dir), 'p0-e2e-escape')
    try {
      const response = await call(routes, COMMAND_URL, 'POST', {
        action: 'create-role',
        name: '逃逸',
        id: '../p0-e2e-escape',
      })
      assert.ok(
        response.status >= 400 && response.status < 500,
        `期望 4xx，实际 ${response.status}`,
      )
      assert.equal(await exists(escaped), false, '数据目录外不应出现新目录')
      assert.equal(await exists(path.join(escaped, 'AGENTS.md')), false)
      assert.equal(await exists(path.join(dir, 'p0-e2e-escape')), false, '逃逸 id 也不该被就地写盘')
    } finally {
      await rm(escaped, { recursive: true, force: true })
    }
  })
})

// ---- A2 —— notes.json 坏 JSON 被当作「文件不存在」，导出静默覆盖用户手改内容 ----

test('A2: notes.json 坏 JSON 时 exportNotes 报错、原文件逐字节不变、留下 corrupt 备份', async () => {
  await withDataDir(async (dir) => {
    const file = notesPath(dir)
    const before = Buffer.from('{ "自我介绍": "用户手改的内容" \n', 'utf8')
    await writeFile(file, before)

    await assert.rejects(() => exportNotes(dir), /不是合法 JSON/)

    const after = await readFile(file)
    assert.deepEqual(after, before, '坏 JSON 的原文件必须逐字节不变')

    const backups = (await readdir(dir)).filter((name) => name.startsWith('notes.json.corrupt-'))
    assert.equal(backups.length, 1, `应留下 1 份 corrupt 备份，实际 ${backups.length}`)
    assert.deepEqual(
      await readFile(path.join(dir, backups[0])),
      before,
      '备份内容应与原文件一致',
    )
  })
})

test('A2: exportNotes 正常路径报告 created / replaced', async () => {
  await withDataDir(async (dir) => {
    const first = await exportNotes(dir)
    assert.equal(first.created, true)
    assert.equal(first.replaced, false)

    const second = await exportNotes(dir)
    assert.equal(second.created, false)
    assert.equal(second.replaced, true, '已存在的 notes.json 应报 replaced')
  })
})

test('A2: 已有手改内容在导出后仍然保留', async () => {
  await withDataDir(async (dir) => {
    await writeFile(notesPath(dir), JSON.stringify({ 自我介绍: '保持这句话' }), 'utf8')
    const result = await exportNotes(dir)
    const written = JSON.parse(await readFile(result.file, 'utf8'))
    assert.equal(written['自我介绍'], '保持这句话')
  })
})

// ---- A1/A2/A3 复核反例回归：这三条是修复本身留下的洞，不是原用例漏测换个输入 ----

test('A1-followup: create-role 拒绝非字符串 id，不会建出 123 / true 目录', async () => {
  await withPlugin(async ({ routes }, dir) => {
    for (const id of [123, true, null, {}, ['team-a']]) {
      const response = await call(routes, COMMAND_URL, 'POST', {
        action: 'create-role',
        name: '类型哨兵',
        id,
      })
      assert.ok(
        response.status >= 400 && response.status < 500,
        `id=${JSON.stringify(id)} 期望 4xx，实际 ${response.status}`,
      )
    }
// String(123) / String(true) 恰好都能过 ID_PATTERN，旧代码会真的建出这两个目录 ——
// 测试要盯磁盘，不是只盯状态码。
    for (const coerced of ['123', 'true', '[object Object]']) {
      assert.equal(await exists(path.join(dir, coerced)), false, `不应就地建出 ${coerced}/`)
    }
  })
})

test('A1-followup: update-role 的 newId 同样拒绝非字符串', async () => {
  await withPlugin(async ({ routes }, dir) => {
    const created = await call(routes, COMMAND_URL, 'POST', {
      action: 'create-role',
      name: '改名前',
      id: 'team-before',
    })
    assert.equal(created.status, 200, `前置的建角色应成功：${JSON.stringify(created.json)}`)

    const response = await call(routes, COMMAND_URL, 'POST', {
      action: 'update-role',
      id: 'team-before',
      newId: 123,
    })
    assert.ok(
      response.status >= 400 && response.status < 500,
      `期望 4xx，实际 ${response.status}`,
    )
    assert.equal(await exists(path.join(dir, '123')), false, '不应把数字 id 改出目录')
    assert.equal(
      await exists(roleFile(dir, 'team-before')),
      true,
      '改名被拒后原角色应留在原位',
    )
  })
})

test('A2-followup: notes.json 是合法 JSON 却不是对象时，同样拒绝并留备份', async () => {
// 这五个都是合法 JSON，但一个覆盖都表达不了；旧代码把它们规范化成 {} 后直接合并默认值，
// 用 6,799 字节静默盖掉用户文件，还回 replaced: true。
  for (const text of ['null', '[]', '"hello"', '42', 'true']) {
    await withDataDir(async (dir) => {
      const file = notesPath(dir)
      const before = Buffer.from(text, 'utf8')
      await writeFile(file, before)

      await assert.rejects(
        () => exportNotes(dir),
        /必须是一个 JSON 对象/,
        `notes.json = ${text} 应被拒绝`,
      )

      assert.deepEqual(await readFile(file), before, `${text}：原文件必须逐字节不变`)
      const backups = (await readdir(dir)).filter((name) => name.startsWith('notes.json.corrupt-'))
      assert.equal(backups.length, 1, `${text}：应留下 1 份备份，实际 ${backups.length}`)
      assert.deepEqual(await readFile(path.join(dir, backups[0])), before, '备份内容应与原文件一致')
    })
  }
})
