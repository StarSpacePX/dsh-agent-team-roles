/** 配置说明书与批量开关（notes.json 是数据 / set-switches 一次手势一个请求）。
 * 从 tests/plugin/team-and-config.test.mjs 拆出（超 400 行红线），用例体逐字未改。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { DEFAULT_NOTES, NOTE_KEYS } from '../../lib/notes.js'
import { call, withPlugin } from '../support/harness.mjs'
import path from 'node:path'
import { withHome, definitionOf, argumentText, STATE_URL, COMMAND_URL } from '../support/plugin-fixtures.mjs'

//#region §5.34 — 说明书是数据（m08033）

test('the panel reads its explanations from notes.json, and a missing file is not an error', async () => {
  await withPlugin(async ({ routes }, dir) => {
    const state = await call(routes, STATE_URL)
    assert.equal(state.status, 200)
    assert.equal(state.json.notes.error, null)
    assert.equal(state.json.notesFile, path.join(dir, 'notes.json'))
    // 一份都没有改过：全部键都来自内置默认值
    assert.deepEqual(state.json.notes.custom, [])
    assert.equal(state.json.notes.values.refresh, DEFAULT_NOTES.refresh)
    assert.equal(state.json.notes.values.teamOff, DEFAULT_NOTES.teamOff)
    // 客户端兜底用的那句话必须和这里的主键对得上（否则老宿主半下会错位）
    assert.equal(NOTE_KEYS.includes('rowsReset'), true)
  })
})

test('editing notes.json changes what /state serves, without touching the code', async () => {
  await withPlugin(async ({ routes }, dir) => {
    await writeFile(path.join(dir, 'notes.json'), JSON.stringify({ teamOff: '我这里就这么说' }), 'utf8')
    const state = await call(routes, STATE_URL)
    assert.equal(state.json.notes.values.teamOff, '我这里就这么说')
    assert.deepEqual(state.json.notes.custom, ['teamOff'])
    // 没写的键继续用内置默认值：老文件不会把新加的说明变成空的
    assert.equal(state.json.notes.values.refresh, DEFAULT_NOTES.refresh)
  })
})

test('a broken notes.json is reported, and every default still renders', async () => {
  await withPlugin(async ({ routes }, dir) => {
    await writeFile(path.join(dir, 'notes.json'), '{ 这不是 json', 'utf8')
    const state = await call(routes, STATE_URL)
    assert.equal(state.status, 200)
    assert.match(state.json.notes.error, /不是合法 JSON/)
    assert.equal(state.json.notes.values.refresh, DEFAULT_NOTES.refresh)
    // 非字符串的值直接被丢掉，不能把说明变成 "[object Object]"
    await writeFile(path.join(dir, 'notes.json'), JSON.stringify({ refresh: { a: 1 }, teamOff: '   ' }), 'utf8')
    const second = await call(routes, STATE_URL)
    assert.equal(second.json.notes.error, null)
    assert.equal(second.json.notes.values.refresh, DEFAULT_NOTES.refresh)
    assert.equal(second.json.notes.values.teamOff, DEFAULT_NOTES.teamOff)
    assert.deepEqual(second.json.notes.custom, [])
  })
})

test('export-notes writes every key once, and never overwrites an edited one', async () => {
  await withPlugin(async ({ routes }, dir) => {
    const file = path.join(dir, 'notes.json')
    const first = await call(routes, COMMAND_URL, 'POST', { action: 'export-notes' })
    assert.equal(first.status, 200)
    assert.equal(first.json.result.file, file)
    assert.equal(first.json.result.created, true)
    assert.equal(first.json.result.keys.length, NOTE_KEYS.length)

    const written = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(written.rows, DEFAULT_NOTES.rows)
    // 导出的文件必须能直接被读回来，而且是「所有键都有」
    assert.deepEqual(Object.keys(written).sort(), [...NOTE_KEYS].sort())

    // 用户改了一句，再导出一次：他的版本必须留下来
    await writeFile(file, JSON.stringify({ ...written, rows: '我的说法' }), 'utf8')
    const second = await call(routes, COMMAND_URL, 'POST', { action: 'export-notes' })
    assert.equal(second.json.result.created, false)
    assert.equal(second.json.state.notes.values.rows, '我的说法')
    assert.equal(JSON.parse(await readFile(file, 'utf8')).rows, '我的说法')
  })
})

/** 从 source[open] === '(' 开始的实参文本。
 * 括号配平、跳过引号，够这个文件用（实参只有字符串字面量与其它调用）。 */

test('every explanation the client asks for by key exists in the defaults', async () => {
// 客户端把说明写成 describe('key', fallback) / info('key', fallback) / section('标题', 'key', fallback)。
// 拼错、或只存在于某一侧的 key 会在运行时静默退回 fallback：不报错，只是用户再也没法在 notes.json 里改那句话。
// 所以这里把客户端真正问到的 key 全部抓出来，和默认值对一遍。
  const source = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
  const used = new Set()
  const patterns = [
    /\bdescribe\(\s*'([A-Za-z0-9_]+)'/g,
    /\binfo\(\s*'([A-Za-z0-9_]+)'/g,
    /\bsection\(\s*'[^']*',\s*'([A-Za-z0-9_]+)'/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) used.add(match[1])
  }

  assert.ok(used.size > 10, `regex 只抓到 ${used.size} 个 key，说明客户端的写法变了`)
  const missing = [...used].filter((key) => !NOTE_KEYS.includes(key))
  assert.deepEqual(missing, [], `这些 key 不在 notes.js 的默认值里：${missing.join(' / ')}`)

// 另一半契约：note() 只拼字符串（非字符串会被静默丢掉），section() 第三参也必须是字符串。
// 所以 info()（返回的是元素）只能挂在树里，塞进 note() / section() 会让那段 ⓘ 整个消失。
  for (const name of ['note', 'section']) {
    for (const match of source.matchAll(new RegExp(`\\b${name}\\(`, 'g'))) {
      const args = argumentText(source, match.index + match[0].length - 1)
      const line = source.slice(0, match.index).split('\n').length
      assert.ok(!/\binfo\(/.test(args), `${name}() 的第 ${line} 行参数里出现了 info()：那里要的是字符串，用 describe()`)
    }
  }
})

//#endregion

//#region §5.39 — 批量开关：一次手势一个请求（用户 m09376「批量 action必须做」）

/** set-switches 的要点：N 行进、**一次**预设重建出。
 * 重建是注册表记录的动作（apply 拆掉旧挂载、注册新的），所以数注册次数就是数 sync() 调用，
 * 一批无论带多少行都只能多一次。 */

test('set-switches lands a whole gesture in one request, and rebuilds presets once', async () => {
  await withHome(async (home) => {
    await withPlugin(
      async ({ registered, routes }) => {
        await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })
        const state = await call(routes, STATE_URL)
        const role = state.json.roles.find((entry) => entry.id === 'team-reviewer')
        const rows = role.rows
          .filter((row) => ['skill', 'tool', 'group', 'other'].includes(row.category))
          .slice(0, 4)
        assert.equal(rows.length, 4, 'the standard template should offer at least four switchable rows')

        const before = registered.length
        // The wire speaks `disabled` (true = 关), exactly like `set-override`.
        const batch = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-switches',
          id: 'team-reviewer',
          rows: Object.fromEntries(rows.map((row) => [row.id, false])),
          mcp: { github: false },
        })
        assert.equal(batch.status, 200)
        assert.equal(registered.length - before, 1, 'one batch must mean one rebuild, not one per row')
        assert.deepEqual(batch.json.rows, rows.map((row) => row.id))
        assert.deepEqual(batch.json.mcp, ['github'])

// 回包就是新真相：批次里每一行都开着并带 override，没被点名的行一个不动。
        const next = batch.json.state.roles.find((entry) => entry.id === 'team-reviewer')
        for (const row of rows) {
          const after = next.rows.find((entry) => entry.id === row.id)
          assert.equal(after.disabled, false, `${row.id} should be on`)
          assert.equal(after.hasOverride, true, `${row.id} should be overridden`)
        }
        assert.deepEqual(next.capabilities.mcp.deny, ['github'])
        // …and the gateway row is in the composed preset, so the switch is real.
        assert.deepEqual(
          definitionOf(registered, 'team-reviewer').plugins.filter((row) => row.id === 'agent-team-mcp-gate'),
          [
            {
              id: 'agent-team-mcp-gate',
              name: 'dsh-agent-team-roles',
              config: { mcpGate: { deny: ['github'] } },
            },
          ],
        )
      },
      undefined,
      { home },
    )
  })
})

/**
 * The batch action is not a second implementation of the rules: it is the same
 * two helpers the single-item actions use, applied to a map. Two roles given the
 * same change — one row at a time, one batch — must end up byte-identical.
 */

test('a batch writes exactly what the single-item actions write', async () => {
  await withHome(async (home) => {
    await withPlugin(
      async ({ routes }) => {
        await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'One' })
        await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Batch' })
        const ids = (await call(routes, STATE_URL)).json.roles.map((role) => role.id)
        assert.equal(ids.length, 2)

        const single = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-override',
          id: ids[0],
          row: 'tool-bash',
          disabled: false,
        })
        assert.equal(single.status, 200)
        await call(routes, COMMAND_URL, 'POST', {
          action: 'set-mcp',
          id: ids[0],
          server: 'github',
          enabled: false,
        })
        const batched = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-switches',
          id: ids[1],
          rows: { 'tool-bash': false },
          mcp: { github: false },
        })

        // Read the first role back *after* its second action: the reply to
        // `set-override` is a snapshot from before the MCP change.
        const one = (await call(routes, STATE_URL)).json.roles.find((role) => role.id === ids[0])
        const many = batched.json.state.roles.find((role) => role.id === ids[1])
        const pick = (role) => ({
          row: role.rows.find((row) => row.id === 'tool-bash'),
          deny: role.capabilities.mcp.deny,
        })
        assert.deepEqual(pick(many), pick(one))
      },
      undefined,
      { home },
    )
  })
})

test('set-switches refuses an empty batch and a switch that is not a boolean', async () => {
  await withHome(async (home) => {
    await withPlugin(
      async ({ routes }) => {
        await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })
        const empty = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-switches',
          id: 'team-reviewer',
          rows: {},
          mcp: {},
        })
        assert.equal(empty.status, 400)
        assert.match(empty.json.error, /需要 rows、mcp 或 tools/)

        const notBoolean = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-switches',
          id: 'team-reviewer',
          rows: { 'tool-bash': 'yes' },
        })
        assert.equal(notBoolean.status, 400)
        assert.match(notBoolean.json.error, /行开关必须是布尔值/)

        // An array is not a map, and must not be read as one.
        const array = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-switches',
          id: 'team-reviewer',
          rows: ['tool-bash'],
        })
        assert.equal(array.status, 400)
        assert.match(array.json.error, /需要 rows、mcp 或 tools/)

        const unknown = await call(routes, COMMAND_URL, 'POST', {
          action: 'set-switches',
          id: 'team-reviewer',
          mcp: { github: false, 'not-a-server': true },
        })
        assert.equal(unknown.status, 400)
        assert.match(unknown.json.error, /not-a-server/)
        // The refused batch left nothing behind: no deny entry, no gateway row.
        const state = await call(routes, STATE_URL)
        assert.deepEqual(
          state.json.roles.find((role) => role.id === 'team-reviewer').capabilities.mcp.deny,
          [],
        )
      },
      undefined,
      { home },
    )
  })
})

//#endregion
