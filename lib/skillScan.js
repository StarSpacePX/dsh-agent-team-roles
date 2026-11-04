/**
 * 扫描部署里的技能目录（§5.47 / §7 F10）。
 *
 * 从 `skills.js` 拆出（长脚本拆分）。这里只做「找」：把默认根走一遍，读每个
 * 候选的 `SKILL.md` 头，按根的顺序去重。选择逻辑（inherit / pick）留在
 * `skills.js` 里，两边共用一个 `parseSkillHeader`。
 *
 * @module dsh-agent-team-roles/skillScan
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { dshHome } from './deployment.js'

/** The file a skill directory must carry. */
const SKILL_FILE = 'SKILL.md'

/**
 * The roots the deployment's own discovery would walk, in its precedence order.
 *
 * This is the *same* list `dsh-skill-filesystem.roots()` builds with
 * `includeDefaultRoots: true` (`lib/index.js:150-188`), spelled out here because
 * the panel has to list what is there without a provider instance of its own.
 * The custom root (rank 300) is deliberately absent: it is this plugin's own
 * output, and offering it back to the user would be a loop.
 *
 * @param {{ home?: string, cwd?: string }} [options]
 * @returns {{ id: string, label: string, path: string, rank: number }[]}
 */
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

/**
 * Read `name` / `description` out of a skill file's YAML frontmatter.
 *
 * Deliberately small: it is the panel's label, not the loader's parser. A value
 * may be inline (`name: push`), quoted, or a folded block (`description: >`
 * followed by indented lines) — the three shapes the skills in this deployment
 * actually use. Anything else falls back to the directory name and an empty
 * description, which is shown as-is rather than guessed at.
 *
 * @param {string} text
 * @returns {{ name: string | null, description: string }}
 */
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
      // A folded/literal block: take the indented lines that follow.
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

/**
 * §7 F10 — how many skill files `scanSkills` touches at once.
 *
 * The scan is pure I/O over a deployment-controlled directory, so the entries
 * are read concurrently; the cap is not decoration: an unbounded `Promise.all`
 * over a large skills directory opens that many file descriptors at once.
 */
const SKILL_SCAN_CONCURRENCY = 32

/**
 * `Array.prototype.map` for async work, with a fixed number of slots in flight.
 *
 * Results keep their **input positions**, so a caller that depends on listing
 * order — like the first-root-wins de-duplication in `scanSkills` — can still
 * walk the originals after every read has settled.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} run
 * @returns {Promise<R[]>}
 */
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

/**
 * One root entry as a skill, or `null` when it is neither a directory with a
 * `SKILL.md` nor an `.md` file.
 *
 * Junctions and symlinks are followed on purpose: the skills in this deployment
 * are plain directories, but a user who links one in should see it exactly like
 * the loader does (`dsh-skill-filesystem` resolves the real path when it reads).
 *
 * @param {{ path: string }} root
 * @param {import('node:fs').Dirent} entry
 * @returns {Promise<{ kind: 'directory' | 'file', dir: string, file: string } | null>}
 */
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

/**
 * List the skills the default roots hold.
 *
 * A root's entries are either skill *directories* (they carry `SKILL.md`) or
 * single `.md` files — both are shapes `discoverRoot` accepts, so both are
 * listed. Names are de-duplicated in root order: the first root to offer a name
 * is the one the loader would resolve, so that is the one the panel shows.
 *
 * A missing root is not an error (nobody uses `.agents/skills`); an unreadable
 * one is reported instead of hidden.
 *
 * @param {{ home?: string, cwd?: string }} [options]
 * @returns {Promise<{ roots: object[], skills: object[], error: string | null }>}
 */
export async function scanSkills(options = {}) {
  /** @type {object[]} */
  const roots = []
  /** @type {object[]} */
  const skills = []
  const seen = new Set()
  /** @type {string[]} */
  const problems = []

  for (const root of skillRoots(options)) {
    /** @type {{ id: string, label: string, path: string, rank: number, exists: boolean }}} */
    const described = { ...root, exists: false }
    /** @type {import('node:fs').Dirent[]} */
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

    // §7 F10 — stat every entry and read every `SKILL.md` concurrently, then
    // walk the results **in listing order** so the de-duplication above keeps
    // meaning "the first root to offer this name wins".
    const candidates = await mapLimited(entries, SKILL_SCAN_CONCURRENCY, (entry) => candidateOf(root, entry))
    const texts = await mapLimited(candidates, SKILL_SCAN_CONCURRENCY, (candidate) =>
      candidate === null ? Promise.resolve(null) : readFile(candidate.file, 'utf8').catch(() => null),
    )

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]
      const candidate = candidates[index]
      if (candidate === null) continue
      // A skill directory whose SKILL.md vanished between the listing and the
      // read is simply not offered; the loader would skip it too.
      const text = texts[index]
      if (text === null) continue
      const header = parseSkillHeader(text)
      // Parity with the loader, not convenience: `parseSkillFile` warns and skips
      // an entry whose frontmatter has no `name` (`dsh-skill-filesystem`), so
      // listing it would offer a checkbox that mounts nothing.
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
