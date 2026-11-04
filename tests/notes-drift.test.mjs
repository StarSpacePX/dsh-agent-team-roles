// F5（task-9）——宿主 DEFAULT_NOTES 与客户端内联兜底文案的漂移测试。
//
// 背景：说明文字的真源是宿主 `lib/notes.js` 的 DEFAULT_NOTES，`/state` 的 notes.values 把它送到面板；
// 客户端 `src/client/**` 里为了「宿主半还没重启 / 旧宿主没有这个键」逐字保留了同一份兜底文案。
// F 记录 §4 的取舍：只加本漂移测试，不合并单一来源——客户端是独立 bundle，运行时拿不到宿主模块。
//
// 断言三件事：
//   1. 客户端传给 describe/info/section 的键字面量必须都在 DEFAULT_NOTES 里（键集合）；
//   2. 能静态配对的 (<键>, <兜底字面量>) 必须与 DEFAULT_NOTES[键] 逐字相等（文案一致）；
//   3. 配对数量不低于 F5 落地时的观测值，防止解析器悄悄退化成「什么都不查」。
// 静态配不出映射的调用点（运行期变量键、对象字面量查表）只列在 UNCHECKED，不硬造规则。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_NOTES } from '../lib/notes.js'

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CLIENT_ROOT = path.join(PLUGIN_ROOT, 'src', 'client')

// ---- 括号配平：只在源码级找「一个调用的右括号」，注释与各种字符串都跳过 ----
function matchParen(src, open) {
  const stack = []
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    const top = stack[stack.length - 1]
    if (top === 'line' || top === 'block') {
      if (top === 'line' && c === '\n') stack.pop()
      else if (top === 'block' && c === '*' && src[i + 1] === '/') { stack.pop(); i++ }
      continue
    }
    if (top === 'sq' || top === 'dq') {
      if (c === '\\') i++
      else if ((top === 'sq' && c === "'") || (top === 'dq' && c === '"')) stack.pop()
      continue
    }
    if (top === 'tpl') {
      if (c === '\\') i++
      else if (c === '`') stack.pop()
      else if (c === '$' && src[i + 1] === '{') { stack.push('tplExpr'); stack.push('brace'); i++ }
      continue
    }
    if (top === 'brace') {
      if (c === '{') stack.push('brace')
      else if (c === '}') { stack.pop(); if (stack[stack.length - 1] === 'tplExpr') stack.pop() }
      else if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === "'") stack.push('sq')
      else if (c === '"') stack.push('dq')
      else if (c === '`') stack.push('tpl')
      continue
    }
    // code
    if (c === "'") stack.push('sq')
    else if (c === '"') stack.push('dq')
    else if (c === '`') stack.push('tpl')
    else if (c === '/' && src[i + 1] === '/') { stack.push('line'); i++ }
    else if (c === '/' && src[i + 1] === '*') { stack.push('block'); i++ }
    else if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return i }
  }
  return -1
}

// ---- 顶层逗号切参 ----
function splitArgs(text) {
  const parts = []
  const stack = []
  let start = 0
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const top = stack[stack.length - 1]
    if (top === 'sq' || top === 'dq') {
      if (c === '\\') i++
      else if ((top === 'sq' && c === "'") || (top === 'dq' && c === '"')) stack.pop()
      continue
    }
    if (top === 'tpl') {
      if (c === '\\') i++
      else if (c === '`') stack.pop()
      else if (c === '$' && text[i + 1] === '{') { stack.push('tplExpr'); stack.push('brace'); i++ }
      continue
    }
    if (top === 'brace') {
      if (c === '{') stack.push('brace')
      else if (c === '}') { stack.pop(); if (stack[stack.length - 1] === 'tplExpr') stack.pop() }
      else if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === "'") stack.push('sq')
      else if (c === '"') stack.push('dq')
      else if (c === '`') stack.push('tpl')
      continue
    }
    if (c === "'") stack.push('sq')
    else if (c === '"') stack.push('dq')
    else if (c === '`') stack.push('tpl')
    else if (c === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i); i = nl === -1 ? text.length : nl }
    else if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end === -1 ? text.length : end + 1 }
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  parts.push(text.slice(start))
  return parts.map((s) => s.trim())
}

// ---- 顶层三元（只认「一个 ? 且两支都是字面量」的简单形态）----
function splitTernary(text) {
  const stack = []
  let depth = 0
  let q = -1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const top = stack[stack.length - 1]
    if (top === 'sq' || top === 'dq') {
      if (c === '\\') i++
      else if ((top === 'sq' && c === "'") || (top === 'dq' && c === '"')) stack.pop()
      continue
    }
    if (top === 'tpl') {
      if (c === '\\') i++
      else if (c === '`') stack.pop()
      continue
    }
    if (c === "'") stack.push('sq')
    else if (c === '"') stack.push('dq')
    else if (c === '`') stack.push('tpl')
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (depth === 0 && c === '?') {
      if (text[i + 1] === '?' || text[i - 1] === '?' || text[i + 1] === '.') continue
      if (q !== -1) return null // 嵌套三元：不算
      q = i
    }
  }
  if (q === -1) return null
  const stack2 = []
  let d2 = 0
  for (let i = q + 1; i < text.length; i++) {
    const c = text[i]
    const top = stack2[stack2.length - 1]
    if (top === 'sq' || top === 'dq') {
      if (c === '\\') i++
      else if ((top === 'sq' && c === "'") || (top === 'dq' && c === '"')) stack2.pop()
      continue
    }
    if (c === "'") stack2.push('sq')
    else if (c === '"') stack2.push('dq')
    else if ('([{'.includes(c)) d2++
    else if (')]}'.includes(c)) d2--
    else if (d2 === 0 && c === ':') return [text.slice(0, q).trim(), text.slice(q + 1, i).trim(), text.slice(i + 1).trim()]
  }
  return null
}

// ---- 整个表达式就是一个字符串字面量？----
function soleLiteral(expr) {
  if (expr === undefined) return null
  if (/^'(?:[^'\\]|\\.)*'$/s.test(expr)) return expr.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  if (/^"(?:[^"\\]|\\.)*"$/s.test(expr)) return expr.slice(1, -1)
  if (/^`(?:[^`\\]|\\.)*`$/s.test(expr)) return expr.slice(1, -1).replace(/\\`/g, '`')
  return null
}

// 比较用骨架：空白折叠成一个空格；两侧占位符都映射成 «»（宿主 `{name}`、客户端 `${…}`）。
function normalize(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .replace(/\$\{[^{}]*\}/g, '«»')
    .replace(/\{[^{}]*\}/g, '«»')
    .trim()
}

const KEY_LIKE = /^[a-z][A-Za-z0-9]*$/

async function listClientSources(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listClientSources(full)))
    else if (entry.name.endsWith('.js') && entry.name !== 'notes.js') out.push(full)
  }
  return out
}

// 返回 { pairs: [{key, literal, site}], keys: Map<key, site>, unchecked: [{site, reason}] }
async function collect() {
  const pairs = []
  const keySites = new Map()
  const unchecked = []
  for (const file of await listClientSources(CLIENT_ROOT)) {
    const src = await readFile(file, 'utf8')
    const rel = path.relative(PLUGIN_ROOT, file).replace(/\\/g, '/')
    for (const callee of ['describe', 'info', 'section']) {
      const re = new RegExp(`(?<![\\w.$])${callee}\\s*\\(`, 'g')
      let hit
      while ((hit = re.exec(src)) !== null) {
        const open = hit.index + hit[0].length - 1
        const close = matchParen(src, open)
        if (close === -1) { unchecked.push({ site: `${rel}:?`, reason: `${callee} 括号没配平` }); continue }
        re.lastIndex = close
        const site = `${rel}:${src.slice(0, hit.index).split('\n').length}`
        const args = splitArgs(src.slice(open + 1, close))
        const keyExpr = args[callee === 'section' ? 1 : 0]
        const fbExpr = args[callee === 'section' ? 2 : 1]
        const keys = [...(keyExpr ?? '').matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)]
          .map((m) => m[1] ?? m[2])
          .filter((k) => KEY_LIKE.test(k))
        for (const key of keys) if (!keySites.has(key)) keySites.set(key, site)
        if (fbExpr === undefined || keys.length === 0) {
          if (keys.length === 0 && fbExpr !== undefined) unchecked.push({ site, reason: `${callee} 的键不是字面量` })
          continue
        }
        const flat = soleLiteral(fbExpr)
        if (flat !== null) {
          if (keys.length !== 1) { unchecked.push({ site, reason: `${keys.length} 个键对 1 段文案，配不出顺序` }); continue }
          pairs.push({ key: keys[0], literal: flat, site })
          continue
        }
        const branches = splitTernary(fbExpr)
        if (branches !== null) {
          const lits = branches.slice(1).map(soleLiteral)
          if (lits.every((x) => x !== null) && lits.length === keys.length) {
            keys.forEach((key, i) => pairs.push({ key, literal: lits[i], site }))
            continue
          }
        }
        unchecked.push({ site, reason: `${callee} 的兜底不是可静态配对的字面量（运行期变量键 / note(...) 包裹由内层 describe 覆盖）` })
      }
    }
  }
  return { pairs, keySites, unchecked }
}

if (process.env.NOTES_DRIFT_DIAG === '1') {
  const { pairs, keySites, unchecked } = await collect()
  console.log('pairs', pairs.length, 'keys', keySites.size, 'unchecked', unchecked.length)
  for (const p of pairs) {
    const same = normalize(p.literal) === normalize(DEFAULT_NOTES[p.key] ?? '')
    if (!same) console.log('DRIFT', p.key, p.site, '\n  host  =', JSON.stringify(DEFAULT_NOTES[p.key]), '\n  client=', JSON.stringify(p.literal))
  }
  for (const u of unchecked) console.log('unchecked', u.site, '—', u.reason)
  for (const [k, s] of keySites) if (!(k in DEFAULT_NOTES)) console.log('UNKNOWN KEY', k, s)
}

test('notes 漂移：客户端用到的消息键都在宿主 DEFAULT_NOTES 里', async () => {
  const { keySites } = await collect()
  const unknown = [...keySites].filter(([key]) => !(key in DEFAULT_NOTES))
  assert.deepEqual(unknown, [], `客户端引用了 DEFAULT_NOTES 里没有的键：${JSON.stringify(unknown)}`)
  assert.ok(keySites.size >= 30, `只解析到 ${keySites.size} 个键，解析器可能退化了`)
})

test('notes 漂移：能静态配对的兜底文案与 DEFAULT_NOTES 逐字一致', async () => {
  const { pairs } = await collect()
  assert.ok(pairs.length >= 30, `只配出 ${pairs.length} 对 (<键>, <兜底>)，解析器可能退化了`)
  const drift = []
  for (const { key, literal, site } of pairs) {
    const host = DEFAULT_NOTES[key]
    if (typeof host !== 'string') { drift.push({ key, site, host: `DEFAULT_NOTES[${key}] 不是字符串` }); continue }
    if (normalize(host) !== normalize(literal)) drift.push({ key, site, host: normalize(host), client: normalize(literal) })
  }
  assert.deepEqual(drift, [], `文案漂移（宿主 lib/notes.js 是单一点）：\n${JSON.stringify(drift, null, 2)}`)
})
