/**
 * 扫描部署里的技能目录：只做「找」——把默认根走一遍、读每个候选的 SKILL.md 头、按根的顺序去重。
 * 选择逻辑（inherit / pick）在 skills.js，两边共用 parseSkillHeader。
 *
 * @module dsh-agent-team-roles/skillScan
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { dshHome } from './deployment.js'

/** 技能目录必须带的文件。 */
const SKILL_FILE = 'SKILL.md'

/** 部署自己的发现会走的根目录，按优先级顺序（与 includeDefaultRoots: true 那份清单一致）。
 * 面板要能列出实际存在的技能，又不能自己起一个 provider 实例，所以在这里写一份；
 * 自定义根不在此列——那是本插件自己的根。 */
export function skillRoots(options = {}) {
  const home = options.home ?? dshHome()
  const cwd = options.cwd ?? process.cwd()
  return [
    { id: 'project-dsh', label: '项目 .dsh/skills', path: path.join(cwd, '.dsh', 'skills'), rank: 100 },
    { id: 'project-agents', label: '项目 .agents/skills', path: path.join(cwd, '.agents', 'skills'), rank: 200 },
    { id: 'user-dsh', label: '用户 ~/.dsh/skills', path: path.join(home, 'skills'), rank: 400 },
    { id: 'user-agents', label: '用户 ~/.agents/skills', path: path.join(os.homedir(), '.agents', 'skills'), rank: 500 },
  ]
}

/** 从技能文件的 YAML frontmatter 里读 name / description。
 * 故意做得小：只覆盖这个部署里技能实际用到的三种写法（行内、引号、折叠块）；
 * 其余回落目录名与空描述——它是面板标签，不是加载器的解析器。
 * @param {string} text @param {string} [fallback] @returns {{ name: string, description: string }} */
export function parseSkillHeader(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)
  if (match === null) return { name: null, description: '' }

  const lines = match[1].split(/\r?\n/)
  const read = (key) => {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const field = new RegExp(`^${key}\\s*:\\s*(.*)$`).exec(line)
      if (field === null) continue
      const inline = field[1].trim()
      if (inline.length > 0 && inline !== '>' && inline !== '|' && inline !== '>-' && inline !== '|-') {
        return inline.replace(/^['"]|['"]$/g, '').trim()
      }
// 折叠块：取后面缩进的行。
      const parts = []
      for (let next = index + 1; next < lines.length; next += 1) {
        const continuation = lines[next]
        if (continuation.trim().length === 0) continue
        if (!/^\s+\S/.test(continuation)) break
        parts.push(continuation.trim())
      }
      return parts.join(' ').trim()
    }
    return ''
  }

  const name = read('name')
  return { name: name.length > 0 ? name : null, description: read('description') }
}

/** 一次并发读多少个技能文件：扫描是纯 I/O，但无上限的 Promise.all 会一次开掉那么多文件描述符。 */
const SKILL_SCAN_CONCURRENCY = 32

/** 带固定并发槽的异步 map。
 * 结果保持输入位置，所以依赖列举顺序的去重仍能遍历原始列表。
 * @template T, R @param {T[]} items @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker @returns {Promise<R[]>} */
async function mapLimited(items, limit, run) {
  const results = /** @type {R[]} */ (new Array(items.length))
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await run(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/** 把一个根条目变成技能；既不是带 SKILL.md 的目录也不是 .md 文件时返回 null。
 * 故意跟随 junction 与 symlink：用户链进来的技能应该和加载器看到的一样。
 * @param {{ path: string }} entry @returns {object | null} */
async function candidateOf(root, entry) {
  let directory = entry.isDirectory()
  if (!directory && entry.isSymbolicLink()) {
    try {
      directory = (await stat(path.join(root.path, entry.name))).isDirectory()
    } catch {
      return null
    }
  }

  if (directory) {
    return { kind: 'directory', dir: path.join(root.path, entry.name), file: path.join(root.path, entry.name, SKILL_FILE) }
  }
  if (entry.isFile() && /\.md$/i.test(entry.name)) {
    return { kind: 'file', dir: root.path, file: path.join(root.path, entry.name) }
  }
  return null
}

/** 列出默认根里持有的技能：条目可以是带 SKILL.md 的目录，也可以是单个 .md 文件。
 * 名字按根顺序去重，第一个提供该名字的根胜出，因为加载器解析的就是那一个。
 * 根不存在不是错误。
 * @returns {Promise<object[]>} */
export async function scanSkills(options = {}) {
  const roots = []
  const skills = []
  const seen = new Set()
  const problems = []

  for (const root of skillRoots(options)) {
    const described = { ...root, exists: false }
    let entries = []
    try {
      entries = await readdir(root.path, { withFileTypes: true })
      described.exists = true
    } catch (error) {
      if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') {
        problems.push(`${root.path}：${String((error && error.message) || error)}`)
      }
    }
    roots.push(described)

// 并发 stat 每个条目并读 SKILL.md，然后按列举顺序遍历结果，让去重仍然表示「第一个提供该名字的根胜出」。
    const candidates = await mapLimited(entries, SKILL_SCAN_CONCURRENCY, (entry) => candidateOf(root, entry))
    const texts = await mapLimited(candidates, SKILL_SCAN_CONCURRENCY, (candidate) =>
      candidate === null ? Promise.resolve(null) : readFile(candidate.file, 'utf8').catch(() => null),
    )

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]
      const candidate = candidates[index]
      if (candidate === null) continue
// 列目录与读取之间 SKILL.md 消失的目录不列出，加载器也会跳过它。
      const text = texts[index]
      if (text === null) continue
      const header = parseSkillHeader(text)
// 与加载器对齐：frontmatter 没有 name 的条目加载器会警告并跳过，列出来只会给一个挂了也没用的勾选框。
      if (header.name === null) continue
      const name = header.name
      if (seen.has(name)) continue
      seen.add(name)
      skills.push({
        name,
        description: header.description,
        label: entry.name.replace(/\.md$/i, ''),
        kind: candidate.kind,
        dir: candidate.dir,
        file: candidate.file,
        root: root.id,
        rootLabel: root.label,
      })
    }
  }

  skills.sort((left, right) => left.name.localeCompare(right.name))
  return { roots, skills, error: problems.length === 0 ? null : problems.join('；') }
}
