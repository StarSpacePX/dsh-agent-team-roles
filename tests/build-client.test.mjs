/** 覆盖 tools/build-client.mjs 构建器：npm test 里的 --check 只证明磁盘产物与当前源码一致，
 * 不证明构建器会拒绝坏输入（export const、动态 import、BOM 都曾让模块静默不转译）。
 * 构建器是 CLI（模块作用域直接跑 main），这里用 TEAM_CLIENT_ROOT 指到临时夹具跑。 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.join(HERE, '..')
const TOOL = path.join(PLUGIN, 'tools', 'build-client.mjs')

/** 夹具根目录：放在插件目录下（与 tools.test.mjs 一致），每个用例自己收尾。 */
async function scratch() {
  return mkdtemp(path.join(PLUGIN, '.tmp-build-client-'))
}

/** 造一套最小 src/client/**：入口 + 一个被导入的模块。 */
async function fixture(root, files) {
  await mkdir(path.join(root, 'src', 'client'), { recursive: true })
  await writeFile(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture-client', exports: { './client': './lib/client.js' } }, null, 2)}\n`,
    'utf8',
  )
  await writeSources(root, files)
}

/** 只覆盖 src/client 下的文件（用于同一夹具里换源码）。 */
async function writeSources(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, 'src', 'client', rel)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, text, 'utf8')
  }
}

const ENTRY = "import { greet } from './util.js';\nexport { greet };\n"
const UTIL = "const greet = (who) => `hello ${who}`;\nexport { greet };\n"

function run(root, args = []) {
  const result = spawnSync(process.execPath, [TOOL, ...args], {
    cwd: PLUGIN,
    encoding: 'utf8',
    env: { ...process.env, TEAM_CLIENT_ROOT: root },
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

test('BUILD1: 源码与产物一致时 --check 通过；改一个字节后报出首个不同行并 exit 1', async () => {
  const root = await scratch()
  try {
    await fixture(root, { 'entry.js': ENTRY, 'util.js': UTIL })

    const built = run(root)
    assert.equal(built.status, 0, built.stderr)
    assert.match(built.stdout, /^client bundle written: .*client\.js \(2 modules, \d+ lines\)$/m)

    const inSync = run(root, ['--check'])
    assert.equal(inSync.status, 0, inSync.stderr)
    assert.match(inSync.stdout, /^--check: .*client\.js 与 src\/client\/\*\* 一致（2 modules）$/m)

// 改一个字节但不重新构建 ⇒ 磁盘产物落后于源码
    await writeSources(root, { 'util.js': UTIL.replace('hello', 'hallo') })
    const drifted = run(root, ['--check'])
    assert.equal(drifted.status, 1)
    assert.match(drifted.stderr, /与 src\/client\/\*\* 不一致/)
    assert.match(drifted.stderr, /首个不同在第 \d+ 行/)
    assert.match(drifted.stderr, /磁盘: ".*hello/)
    assert.match(drifted.stderr, /构建: ".*hallo/)
    assert.match(drifted.stderr, /修法：node tools\/build-client\.mjs/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('BUILD2: 构建器不支持的 ESM 写法一律抛错，不许静默放过', async () => {
  const cases = [
    ['export const', "export const answer = 42;\n"],
    ['export default', 'export default 42;\n'],
    ['export * from', "export * from './util.js';\n"],
    ['export function', 'export function greet() {}\n'],
    ['动态 import()', "import('./util.js');\n"],
    ['动态 import() 在表达式里', "const p = Promise.resolve();\nimport('./util.js').finally(() => p);\n"],
    ['非相对说明符', "import { readFile } from 'node:fs';\n"],
    ['相对说明符缺 .js', "import { greet } from './util';\nexport { greet };\n"],
  ]
  for (const [label, source] of cases) {
    const root = await scratch()
    try {
      await fixture(root, { 'entry.js': source, 'util.js': UTIL })
      const result = run(root)
      assert.equal(result.status, 1, `${label} 应该构建失败，实际 exit ${result.status}`)
      assert.match(
        result.stderr,
        /不支持的语句|不支持的动态 import\(\)|只允许相对导入|必须带 \.js 后缀/,
        `${label} 的报错不是「不支持的写法」：${result.stderr}`,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('BUILD3: 缺模块与循环导入也会被拒绝', async () => {
  const missing = await scratch()
  try {
    await fixture(missing, { 'entry.js': "import { a } from './nope.js';\nexport { a };\n" })
    const result = run(missing)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /client 模块不存在：\.\/nope\.js/)
  } finally {
    await rm(missing, { recursive: true, force: true })
  }

  const cycle = await scratch()
  try {
    await fixture(cycle, {
      'entry.js': "import { a } from './a.js';\nexport { a };\n",
      'a.js': "import { greet } from './entry.js';\nconst a = greet;\nexport { a };\n",
    })
    const result = run(cycle)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /循环导入/)
  } finally {
    await rm(cycle, { recursive: true, force: true })
  }
})

test('BUILD4: 源码带 UTF-8 BOM 时第一行的 import 仍会被转译', async () => {
  const root = await scratch()
  try {
    await fixture(root, { 'entry.js': `\uFEFF${ENTRY}`, 'util.js': UTIL })
    const result = run(root)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /\(2 modules, \d+ lines\)/)

    const bundle = await readFile(path.join(root, 'lib', 'client.js'), 'utf8')
    assert.equal(bundle.includes('\uFEFF'), false, '产物里不该留 BOM')
    assert.match(bundle, /const \{ greet \} = __load\('\.\/util\.js'\);/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('BUILD5: 产物没有残留 ESM 语句，且能从入口拿到导出', async () => {
  const root = await scratch()
  try {
    await fixture(root, { 'entry.js': ENTRY, 'util.js': UTIL })
    assert.equal(run(root).status, 0)

    const source = await readFile(path.join(root, 'lib', 'client.js'), 'utf8')
    const leftover = source
      .split('\n')
      .map((line, index) => [line, index + 1])
      .filter(([line]) => /^\s*(import|export)\b/.test(line))
    assert.deepEqual(leftover, [], '产物里残留了 ESM 语句')

    const loaded = []
    const sandbox = { window: { __ModuleLoader__: { load: (pkg) => loaded.push(pkg) } }, console }
    vm.createContext(sandbox)
    vm.runInContext(source, sandbox, { filename: 'lib/client.js' })

    assert.equal(loaded.length, 1, '__ModuleLoader__.load 应该被调用一次')
    assert.equal(loaded[0].id, 'fixture-client')
    const factory = loaded[0].factory
    assert.equal(typeof factory, 'function')
    const entry = factory(() => {
      throw new Error('夹具不使用 require')
    })
    assert.equal(typeof entry.greet, 'function')
    assert.equal(entry.greet('world'), 'hello world')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
