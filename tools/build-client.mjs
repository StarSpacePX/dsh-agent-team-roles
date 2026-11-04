/** dsh-agent-team-roles 客户端半的构建器（零依赖，只用 Node 内置模块）。
 * 宿主按 package.json 的 exports["./client"] 取件，lib/client.js 必须是一个文件。
 * 这里用可复现的极简打包器代替 tsdown：源码正常分模块写，构建产出单文件。
 * 支持的 ESM 子集故意收窄，越界即构建失败，不允许悄无声息地发生。 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// TEAM_CLIENT_ROOT 是测试缝：自检用例在临时目录造一套 src/client/** 指到这里跑。
const ROOT = process.env.TEAM_CLIENT_ROOT
  ? path.resolve(process.env.TEAM_CLIENT_ROOT)
  : path.join(HERE, '..')
const SRC = path.join(ROOT, 'src', 'client')
const OUT = path.join(ROOT, 'lib', 'client.js')
const ENTRY = './entry.js'

const IMPORT_NAMED = /^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?$/
const IMPORT_NS = /^import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]\s*;?$/
const EXPORT_LIST = /^export\s*\{([^}]*)\}\s*;?$/

/** 把 `a, b as c` 折成 `a, b: c`（对象解构用）。 */
function toObjectPattern(specifiers) {
  return specifiers
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const [name, alias] = part.split(/\s+as\s+/).map((s) => s.trim())
      return alias === undefined ? name : `${name}: ${alias}`
    })
    .join(', ')
}

/** 把 `a, b as c` 折成若干 `exports.b = a;` 语句。 */
function toExportAssignments(specifiers) {
  const lines = []
  for (const part of specifiers.split(',')) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const [name, alias] = trimmed.split(/\s+as\s+/).map((s) => s.trim())
    lines.push(`exports.${alias === undefined ? name : alias} = ${name};`)
  }
  return lines
}

/** 把相对说明符解析成模块 id（相对 src/client 根、始终以 `./` 开头）。 */
function resolveSpecifier(fromId, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    throw new Error(`client 源码只允许相对导入，收到 "${specifier}"（来自 ${fromId}）`)
  }
  if (!specifier.endsWith('.js')) {
    throw new Error(`client 源码的相对导入必须带 .js 后缀，收到 "${specifier}"（来自 ${fromId}）`)
  }
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromId), specifier))
  return joined.startsWith('.') ? joined : `./${joined}`
}

/** 转译一个模块：只做上面那三类语句的替换，其余逐字保留。 */
function transform(id, text) {
  const out = []
  const deps = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    if (trimmed === '' || (!trimmed.startsWith('import') && !trimmed.startsWith('export'))) {
      out.push(line)
      continue
    }
    const where = `${id}:${index + 1}`
// 动态 import() 不在支持子集内：说明符运行时才算出来，构建器解析不了，
// 静默放过只会在浏览器里变成「未知模块」。
    const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
    if (!isComment && /(?<![\w$.])import\s*\(/.test(line)) {
      throw new Error(`client 源码用了构建器不支持的动态 import()（${where}）：${trimmed}`)
    }
    const named = trimmed.match(IMPORT_NAMED)
    if (named !== null) {
      const target = resolveSpecifier(id, named[2])
      deps.push(target)
      out.push(`const { ${toObjectPattern(named[1])} } = __load('${target}');`)
      continue
    }
    const namespace = trimmed.match(IMPORT_NS)
    if (namespace !== null) {
      const target = resolveSpecifier(id, namespace[2])
      deps.push(target)
      out.push(`const ${namespace[1]} = __load('${target}');`)
      continue
    }
    const exported = trimmed.match(EXPORT_LIST)
    if (exported !== null) {
      out.push(...toExportAssignments(exported[1]))
      continue
    }
    throw new Error(`client 源码用了构建器不支持的语句（${where}）：${trimmed}`)
  }
  const body = out.join('\n')
  const leftover = body.split('\n').findIndex((line) => /^\s*(import|export)\b/.test(line))
  if (leftover !== -1) {
    throw new Error(`${id} 转译后仍残留 ESM 语句（第 ${leftover + 1} 行）`)
  }
  return { body, deps: [...new Set(deps)] }
}

/** 读入 src/client 下所有模块，并从入口做深度优先排序（顺带查漏、查环）。 */
async function collect() {
  const modules = new Map()
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.name.endsWith('.js')) continue
      const id = `./${path.relative(SRC, full).split(path.sep).join('/')}`
// 源码可能带 UTF-8 BOM（PowerShell Set-Content -Encoding UTF8 就会写），
// 不剥掉的话第一行 import 判定会失配、整个模块静默不转译。
      modules.set(id, (await readFile(full, 'utf8')).replace(/^\uFEFF/, ''))
    }
  }
  await walk(SRC)

  const order = []
  const bodies = new Map()
  const state = new Map()
  const visit = (id, chain) => {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'visiting') {
      throw new Error(`client 模块存在循环导入：${[...chain, id].join(' → ')}`)
    }
    const source = modules.get(id)
    if (source === undefined) throw new Error(`client 模块不存在：${id}（被 ${chain[chain.length - 1]} 引用）`)
    state.set(id, 'visiting')
    const transformed = transform(id, source)
    bodies.set(id, transformed.body)
    for (const dep of transformed.deps) visit(dep, [...chain, id])
    state.set(id, 'done')
    order.push(id)
  }
  visit(ENTRY, [])
  return { order, bodies }
}

/** 组装最终的 bundle 文本（`bodies` 是**转译后**的模块体，不是原始源码）。 */
function emit(name, bodies, order) {
  const header = [
    '/**',
    ' * `dsh-agent-team-roles` — 浏览器半边（构建产物，请勿手工修改）。',
    ' *',
    ' * 源码在 `src/client/**`，由 `node tools/build-client.mjs` 生成这个文件。',
    ' * 改代码请改源码，然后跑 `npm run build:client`；`npm test` 里带 `--check` 守着它不漂。',
    ' *',
    ' * 模块清单（依赖顺序）：',
    ...order.map((id) => ` *   ${id}`),
    ' */',
  ].join('\n')

  const parts = [header, 'window.__ModuleLoader__.load({', `  id: ${JSON.stringify(name)},`, '  factory: (require) => {']
  parts.push('    // 极简模块表：只服务本 bundle。导入说明符在构建时已解析成模块 id，运行时不做路径解析。')
  parts.push('    const __modules = new Map();')
  parts.push('    const __define = (id, body) => {')
  parts.push('      __modules.set(id, { body, exports: null, loaded: false });')
  parts.push('    };')
  parts.push('    const __load = (id) => {')
  parts.push('      const mod = __modules.get(id);')
  parts.push('      if (mod === undefined) throw new Error(`dsh-agent-team-roles: 未知的客户端模块 ${id}`);')
  parts.push('      if (!mod.loaded) {')
  parts.push('        mod.loaded = true;')
  parts.push('        mod.exports = {};')
  parts.push('        mod.body(mod.exports, __load);')
  parts.push('      }')
  parts.push('      return mod.exports;')
  parts.push('    };')

  for (const id of order) {
    parts.push('')
    parts.push(`    __define(${JSON.stringify(id)}, (exports, __load) => {`)
    for (const line of bodies.get(id).split('\n')) {
      parts.push(line === '' ? '' : `      ${line}`)
    }
    parts.push('    });')
  }

  parts.push('')
  parts.push(`    return __load(${JSON.stringify(ENTRY)});`)
  parts.push('  },')
  parts.push('});')
  return `${parts.join('\n')}\n`
}

async function main() {
  const check = process.argv.includes('--check')
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))
  const { order, bodies } = await collect()
  const built = emit(pkg.name, bodies, order)

  if (!check) {
    await mkdir(path.dirname(OUT), { recursive: true })
    await writeFile(OUT, built, 'utf8')
    const lines = built.split('\n').length - 1
    console.log(`client bundle written: ${path.relative(ROOT, OUT)} (${order.length} modules, ${lines} lines)`)
    return
  }

  let current = null
  try {
    current = await readFile(OUT, 'utf8')
  } catch {
    current = null
  }
  if (current === built) {
    console.log(`--check: ${path.relative(ROOT, OUT)} 与 src/client/** 一致（${order.length} modules）`)
    return
  }
  const currentLines = current === null ? [] : current.split('\n')
  const builtLines = built.split('\n')
  const at = currentLines.findIndex((line, index) => line !== builtLines[index])
  console.error(`--check: ${path.relative(ROOT, OUT)} 与 src/client/** 不一致`)
  console.error(current === null ? '  （产物缺失）' : `  首个不同在第 ${at + 1} 行`)
  if (current !== null) {
    console.error(`  磁盘: ${JSON.stringify(currentLines[at] ?? '')}`)
    console.error(`  构建: ${JSON.stringify(builtLines[at] ?? '')}`)
  }
  console.error('  修法：node tools/build-client.mjs')
  process.exitCode = 1
}

await main()
