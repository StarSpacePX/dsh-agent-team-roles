/**
 * The files one role owns on disk.
 *
 * A role is no longer an entry inside one shared `roles.json`: it owns a whole
 * directory under the plugin's data directory, and everything the user can edit
 * for that role is a file in there.
 *
 *     <dir>/<roleId>/role.json     the role's own configuration
 *     <dir>/<roleId>/AGENTS.md     the role's own instruction file
 *
 * The directory deliberately doubles as the role's working directory. dsh
 * discovers `AGENTS.md` as a *same-directory* candidate while it walks from the
 * session cwd up to the project root (`dsh-agent-instructions`: "Discover
 * host-visible user-global and root-to-cwd instruction candidates"), so a role
 * can only read a rules file of its own if that file sits in the directory its
 * agents run in. Keeping one directory per role means the user never has to
 * type a path: creating a role creates all three things, and the role's loop
 * cwd points at the directory that holds its `AGENTS.md`.
 *
 * @module dsh-agent-team-roles/roleFiles
 */
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { dshHome } from './deployment.js'

/** The instruction file name dsh looks for by default. */
export const AGENTS_MD_FILE = 'AGENTS.md'

/** The role's own configuration file, inside its own directory. */
export const ROLE_FILE = 'role.json'

/**
 * Windows device names, which name a device rather than a file, so no role id
 * may be one.
 */
const RESERVED_IDS = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

/** The longest role id that is still one ordinary path segment. */
const MAX_ID_LENGTH = 64

/**
 * Refuse a role id that cannot be one path segment inside the data directory.
 *
 * This is the hard guard: `roleDir` is the only place a role id becomes a path,
 * and it is called by callers whose id never went through `normalizeRole`.
 * `/command create-role` used to write the role directory *before* validating
 * the role, so an id like `../evil` created `AGENTS.md` outside `<dir>` and was
 * rejected only afterwards (§5.58 A1, measured). Keeping the check here means
 * no caller can reach the filesystem with an escaping id.
 *
 * @param {unknown} id - a role id from a request, a file, or code.
 * @returns {string} the same id, when it is a legal single path segment.
 * @throws {Error} when the id could escape the data directory, or is not a
 *   legal file name on this platform.
 */
export function assertRoleId(id) {
  const text = typeof id === 'string' ? id : ''
  const refuse = (why) => {
    throw new Error(`角色 id ${why}：${JSON.stringify(id ?? null)}`)
  }
  if (text.length === 0) refuse('不能为空')
  if (text !== text.trim()) refuse('首尾不能有空白')
  if (text === '.' || text === '..') refuse('不能是相对路径')
  if (/[\\/:*?"<>|]/.test(text)) refuse('不能包含路径分隔符或非法字符')
  if (path.isAbsolute(text)) refuse('不能是绝对路径')
  if (path.win32.isAbsolute(text)) refuse('不能是绝对路径')
  if (text.endsWith('.')) refuse('不能以点结尾')
  if (RESERVED_IDS.has(text.toLowerCase())) refuse('不能是设备保留名')
  if (text.length > MAX_ID_LENGTH) refuse(`长度不能超过 ${MAX_ID_LENGTH}`)
  return text
}

/**
 * @param {string} dir - the plugin's data directory.
 * @param {string} id - the role (preset) id.
 * @returns {string} the role's own directory.
 * @throws {Error} when `id` is not a legal single path segment.
 */
export function roleDir(dir, id) {
  return path.join(dir, assertRoleId(id))
}

/**
 * @param {string} dir
 * @param {string} id
 * @returns {string} `<role dir>/role.json`.
 */
export function roleFile(dir, id) {
  return path.join(roleDir(dir, id), ROLE_FILE)
}

/**
 * @param {string} dir
 * @param {string} id
 * @returns {string} `<role dir>/AGENTS.md`.
 */
export function agentsMdFile(dir, id) {
  return path.join(roleDir(dir, id), AGENTS_MD_FILE)
}

/**
 * The one file a new role's `AGENTS.md` is copied from: the user-global
 * `$DSH_HOME/AGENTS.md`.
 *
 * Fixed, not discovered (§5.42; user m10123 → m10519: 「这个是固定复制的」). A
 * role's rules file is a snapshot of *your* standing rules. The project chain
 * needs no copying at all: dsh discovers `AGENTS.md`/`CLAUDE.md` live from the
 * directory a session works in and from its ancestors, so a member that enters a
 * project already reads that project's file — copying it into the role would
 * only freeze a copy that goes stale.
 *
 * @param {{ home?: string }} [options]
 * @returns {string} absolute path of the user-global instruction file.
 */
function agentsMdSource(options = {}) {
  const home = typeof options.home === 'string' && options.home.length > 0 ? options.home : dshHome()
  return path.join(home, AGENTS_MD_FILE)
}

/**
 * That file, if it exists and is not empty.
 *
 * @param {{ home?: string }} [options]
 * @returns {Promise<string | null>}
 */
export async function pickAgentsMdSource(options = {}) {
  const source = agentsMdSource(options)
  try {
    const info = await stat(source)
    if (info.isFile() && info.size > 0) return source
  } catch {
    // No user-global instruction file on this machine.
  }

  return null
}

/**
 * Create the role's directory and give it an `AGENTS.md`.
 *
 * A role whose source cannot be found still gets a file: the point of the whole
 * directory is that the user edits *this* role's rules without touching anyone
 * else's, and an empty file is a valid starting point for that.
 *
 * @param {object} options
 * @param {string} options.dir - the plugin's data directory.
 * @param {string} options.id
 * @param {string | null} [options.source] - the file to copy, or `null` to seed a new one.
 * @returns {Promise<{ file: string, source: string | null, copied: boolean }>}
 */
export async function createAgentsMd({ dir, id, source = null }) {
  const target = agentsMdFile(dir, id)
  await mkdir(roleDir(dir, id), { recursive: true })

  if (typeof source === 'string' && source.length > 0) {
    await copyFile(source, target)
    return { file: target, source, copied: true }
  }

  await writeFile(target, `# ${id}\n\n这个角色自己的规则文件（AGENTS.md）。\n`, 'utf8')
  return { file: target, source: null, copied: false }
}

/**
 * Delete everything the role owns.
 *
 * This is what makes "删除角色" mean something: the switches and the directory
 * are the same thing, so leaving the directory behind would leave a role that
 * looks deleted but still has files on disk.
 *
 * @param {string} dir - the plugin's data directory.
 * @param {string} id
 * @returns {Promise<boolean>} whether a directory was there to remove.
 */
export async function removeRoleDir(dir, id) {
  const target = roleDir(dir, id)
  let existed = false
  try {
    existed = (await stat(target)).isDirectory()
  } catch {
    return false
  }
  await rm(target, { recursive: true, force: true })
  return existed
}
