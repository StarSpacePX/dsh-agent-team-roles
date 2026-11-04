/**
 * `roles.json` 的文档层：版本号、原子写、索引的规范化与排序。
 *
 * 从 `store.js` 拆出（长脚本拆分）。这里只有纯函数加「写文件」这一个副作用助手，
 * 不持有任何目录状态 —— 那些状态在 `roleStore.js` 的 `RoleStore` 里。
 *
 * @module dsh-agent-team-roles/storeDocument
 */
import { rename, rm, writeFile } from 'node:fs/promises'

import { normalizeRole } from './storeRole.js'

const FILE = 'roles.json'
const VERSION = 3

/**
 * Write `text` to `file` atomically, and take the temp file with it on failure.
 *
 * A failed write used to leave `<file>.tmp` behind, which the data directory
 * then carries forever: the panel reads that directory, and 「删除角色」 would
 * leave a stray `role.json.tmp` in a role that no longer exists (§5.58 A3
 * follow-up; the independent review measured `tmpLeft: true` after an injected
 * EPERM).
 *
 * @param {string} file - the destination path.
 * @param {string} text - the exact contents to land there.
 * @returns {Promise<void>}
 */
async function writeFileAtomic(file, text) {
  const temporary = `${file}.tmp`
  try {
    await writeFile(temporary, text, 'utf8')
    await rename(temporary, file)
  } catch (failure) {
    // A failing cleanup must not replace the reason the write did not happen:
    // the temp file is a stray, the thrown error is the diagnosis.
    await rm(temporary, { force: true }).catch(() => {})
    throw failure
  }
}

/** @returns {{ version: number, roles: object[], settings: { bindMembers: boolean, hideChatTab: boolean } }} */
function emptyDocument() {
  return { version: VERSION, roles: [], settings: defaultSettings() }
}

/**
 * Document-level switches. They live here rather than in the plugin config
 * because they must be flippable from the UI without a dsh restart, and the
 * config file is only read at load time.
 *
 * @returns {{ bindMembers: boolean, hideChatTab: boolean }}
 */
export function defaultSettings() {
  return { bindMembers: false, hideChatTab: false }
}

/** @param {unknown} parsed @returns {{ version: number, roles: object[], settings: { bindMembers: boolean, hideChatTab: boolean } }} */
function normalizeDocument(parsed) {
  if (parsed === null || typeof parsed !== 'object') return emptyDocument()
  const raw = /** @type {Record<string, unknown>} */ (parsed)
  const list = Array.isArray(raw.roles) ? raw.roles : []

  /** @type {object[]} */
  const roles = []
  for (const entry of list) {
    try {
      const role = normalizeRole(entry)
      if (roles.some((other) => other.id === role.id)) throw new Error(`角色 id 重复：${role.id}`)
      roles.push(role)
    } catch {
      // A malformed role must not take the whole file down; it is reported by
      // the caller through `rejected` instead.
      roles.push({ id: `invalid-${roles.length}`, name: '', description: '', order: 0, overrides: {}, invalid: true })
    }
  }

  const settings = defaultSettings()
  const rawSettings = raw.settings
  if (rawSettings !== null && typeof rawSettings === 'object' && !Array.isArray(rawSettings)) {
    const incoming = /** @type {Record<string, unknown>} */ (rawSettings)
    if (typeof incoming.bindMembers === 'boolean') settings.bindMembers = incoming.bindMembers
    if (typeof incoming.hideChatTab === 'boolean') settings.hideChatTab = incoming.hideChatTab
  }

  return { version: VERSION, roles, settings }
}

/**
 * Sort roles the way the UI lists them: `order`, then id.
 *
 * @param {object[]} roles
 * @returns {object[]}
 */
function orderRoles(roles) {
  return [...roles].sort((a, b) => {
    const left = Number.isFinite(Number(a.order)) ? Number(a.order) : 10
    const right = Number.isFinite(Number(b.order)) ? Number(b.order) : 10
    if (left !== right) return left - right
    return String(a.id).localeCompare(String(b.id))
  })
}

export { FILE, VERSION, writeFileAtomic, emptyDocument, normalizeDocument, orderRoles }
