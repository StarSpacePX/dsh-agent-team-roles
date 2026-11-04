/**
 * `RoleStore`：一个数据目录上的角色仓库。
 *
 * 从 `store.js` 拆出（长脚本拆分）。磁盘布局：
 *
 *     <dir>/roles.json            the plugin's own index (version + settings)
 *     <dir>/<roleId>/role.json    the role's own configuration
 *     <dir>/<roleId>/AGENTS.md    the role's own instruction file
 *
 * 一致性顺序是「先磁盘、后内存」（§5.58 A3）：任何一次写失败之后，
 * 内存里都不会出现一个磁盘上不存在的角色。
 *
 * @module dsh-agent-team-roles/roleStore
 */
import { mkdir, readFile, readdir, rename } from 'node:fs/promises'
import path from 'node:path'

import { nextRoleColor } from './roleColor.js'
import { agentsMdFile, removeRoleDir, roleDir, roleFile } from './roleFiles.js'
import {
  VERSION,
  defaultSettings,
  emptyDocument,
  normalizeDocument,
  orderRoles,
  writeFileAtomic,
} from './storeDocument.js'
import { normalizeRole } from './storeRole.js'

export class RoleStore {
  /** @param {string} dir */
  constructor(dir) {
    this.dir = dir
    /** The plugin's own index file: settings live here, roles do not. */
    this.file = path.join(dir, 'roles.json')
    /** @type {{ version: number, roles: object[], settings: { bindMembers: boolean, hideChatTab: boolean } }} */
    this.document = emptyDocument()
    /** @type {string | null} */
    this.loadError = null
    /** @type {string[]} ids migrated out of the v1 index during the last load. */
    this.migrated = []
    /** @type {string[]} ids that were given a colour during the last load (§5.59). */
    this.colored = []
    this.loaded = false
  }

  /** @param {string} id @returns {string} the role's own directory. */
  roleDirOf(id) {
    return roleDir(this.dir, id)
  }

  /** @param {string} id @returns {string} the role's own configuration file. */
  roleFileOf(id) {
    return roleFile(this.dir, id)
  }

  /** @param {string} id @returns {string} the role's own instruction file. */
  agentsMdOf(id) {
    return agentsMdFile(this.dir, id)
  }

  /**
   * Delete one role's whole directory.
   *
   * `remove` goes through this method instead of calling `removeRoleDir`
   * directly, so that "disk first, memory second" (§5.58 A3) is observable —
   * and testable — from outside the class.
   *
   * @param {string} id
   * @returns {Promise<void>}
   */
  async deleteRoleDirOf(id) {
    await removeRoleDir(this.dir, id)
  }

  /** @returns {object[]} */
  get roles() {
    return this.document.roles
  }

  /** @returns {{ bindMembers: boolean, hideChatTab: boolean }} */
  get settings() {
    return this.document.settings ?? defaultSettings()
  }

  /**
   * Flip one document-level switch and persist it.
   *
   * @param {'bindMembers' | 'hideChatTab'} key
   * @param {boolean} value
   * @returns {Promise<{ bindMembers: boolean, hideChatTab: boolean }>}
   */
  async setSetting(key, value) {
    const settings = { ...this.settings }
    if (key !== 'bindMembers' && key !== 'hideChatTab') throw new Error(`未知设置：${key}`)
    if (typeof value !== 'boolean') throw new Error(`设置 ${key} 必须是布尔值`)
    settings[key] = value
    this.document.settings = settings
    await this.save()
    return settings
  }

  /**
   * Read every role from disk, plus the index file.
   *
   * A missing index is not an error: a fresh install simply has no roles yet.
   * A missing role *directory* is not an error either — the index and the
   * directories are allowed to disagree, and the directories are what the user
   * actually edits.
   *
   * @returns {Promise<{ version: number, roles: object[], settings: { bindMembers: boolean, hideChatTab: boolean } }>}
   */
  async load() {
    /** @type {object[]} */
    let legacy = []
    try {
      const text = await readFile(this.file, 'utf8')
      const parsed = normalizeDocument(JSON.parse(text))
      legacy = parsed.roles
      this.document = { ...parsed, roles: [] }
      this.loadError = null
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        this.document = emptyDocument()
        this.loadError = null
      } else {
        // Refuse to overwrite a file we could not read: the user's settings are
        // still in there, they are just unreadable right now.
        this.loadError = String((error && error.message) || error)
        throw error
      }
    }

    this.document.roles = await this.#readRoles()
    /** @type {string[]} */
    const migrated = []

    // v1 → v2: a role that only exists inside the index becomes a directory of
    // its own. The index is rewritten only after every role has been written, so
    // an interrupted migration leaves the inline copy in place.
    for (const entry of legacy) {
      if (typeof entry.id !== 'string' || entry.invalid === true) continue
      if (this.find(entry.id) !== undefined) continue
      try {
        const role = normalizeRole(entry)
        await this.writeRole(role)
        this.document.roles.push(role)
        migrated.push(role.id)
      } catch {
        // An inline role that cannot be normalized is dropped, not resurrected.
      }
    }

    this.document.roles = orderRoles(this.document.roles)
    this.migrated = migrated

    // §5.59 — 老角色没有颜色就地补一个并写回它自己的 `role.json`（用户 m00378：
    // 「现有角色直接给 json 里面写一个颜色」）。索引文件不需要动：颜色属于角色，
    // 不属于 `roles.json`。写失败不算载入失败 —— 颜色拿不到只是不显示颜色，
    // 不该让整个角色表读不出来。
    /** @type {string[]} */
    const colored = []
    for (const role of this.document.roles) {
      if (role.invalid === true) continue
      if (typeof role.color === 'string' && role.color.length > 0) continue
      const color = nextRoleColor(this.document.roles, role.id)
      try {
        await this.writeRole({ ...role, color })
      } catch {
        continue
      }
      role.color = color
      colored.push(role.id)
    }
    this.colored = colored

    if (migrated.length > 0) await this.save()
    this.loaded = true
    return this.document
  }

  /**
   * Read `<dir>/<roleId>/role.json` for every subdirectory that has one.
   *
   * @returns {Promise<object[]>}
   */
  async #readRoles() {
    /** @type {import('node:fs').Dirent[]} */
    let entries = []
    try {
      entries = await readdir(this.dir, { withFileTypes: true })
    } catch (error) {
      if (error && error.code === 'ENOENT') return []
      throw error
    }

    /** @type {object[]} */
    const roles = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const text = await readFile(roleFile(this.dir, entry.name), 'utf8')
        const role = normalizeRole(JSON.parse(text))
        if (role.id !== entry.name) throw new Error(`目录名与角色 id 不一致：${entry.name} ≠ ${role.id}`)
        roles.push(role)
      } catch (error) {
        if (error && error.code === 'ENOENT') continue
        // A role file that cannot be read is shown as broken rather than
        // silently disappearing — the same contract the v1 index had.
        roles.push({ id: entry.name, name: '', description: '', order: 0, overrides: {}, invalid: true })
      }
    }
    return orderRoles(roles)
  }

  /** @param {string} id @returns {object | undefined} */
  find(id) {
    return this.roles.find((role) => role.id === id)
  }

  /**
   * Insert or replace one role, then persist.
   *
   * @param {unknown} input
   * @returns {Promise<object>} the stored role.
   */
  async upsert(input) {
    const role = normalizeRole(input)
    const index = this.roles.findIndex((existing) => existing.id === role.id)
    const stamped = {
      ...role,
      createdAt: index >= 0 ? this.roles[index].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    // §5.59 — 新角色自动拿一个颜色（用户 m00378：「新角色也是自动写」）。同一次 upsert
    // 也覆盖「磁盘上的老角色还没补过颜色」的情况，所以两条路径只有这一处分配逻辑。
    if (typeof stamped.color !== 'string' || stamped.color.length === 0) {
      stamped.color = nextRoleColor(this.roles, stamped.id)
    }
    // Persist first, publish second (§5.58 A3). Refreshing memory before the
    // write left a role that existed only in RAM when the write failed:
    // `store.roles` already held it while `<dir>/<id>/role.json` did not exist.
    await this.writeRole(stamped)
    if (index >= 0) this.roles[index] = stamped
    else this.roles.push(stamped)
    this.document.roles = orderRoles(this.roles)
    return stamped
  }

  /**
   * §5.57 — 给一个角色换 id（详情面板「角色 ID」那一行保存时走这里）。
   *
   * The id is three things at once: the directory name, the `id` field inside
   * `role.json`, and the preset id the loader registers. So a rename has to move
   * all three together, in that order — the directory first (the file is what
   * the user actually edits), then the file's own field, then the in-memory
   * list. Nothing else about the role moves: overrides are keyed by *row* id,
   * and the role's own `AGENTS.md` travels inside the directory.
   *
   * @param {string} id - the current id.
   * @param {string} nextId - the new id; validated by `normalizeRole`.
   * @returns {Promise<object>} the renamed role (as stored).
   */
  async rename(id, nextId) {
    const index = this.roles.findIndex((role) => role.id === id)
    if (index < 0) throw new Error(`角色不存在：${id}`)
    if (this.roles.some((role) => role.id === nextId)) throw new Error(`角色已存在：${nextId}`)

    const renamed = normalizeRole({ ...this.roles[index], id: nextId })
    // The directory is the first half of the rename and the role file is the
    // second; memory follows both (§5.58 A3). If the file write fails the
    // directory is put back, so disk and memory still name the same id.
    await rename(roleDir(this.dir, id), roleDir(this.dir, nextId))
    try {
      await this.writeRole(renamed)
    } catch (failure) {
      await rename(roleDir(this.dir, nextId), roleDir(this.dir, id))
      throw failure
    }
    this.roles[index] = renamed
    this.document.roles = orderRoles(this.roles)
    return renamed
  }

  /**
   * Write one role's own file, atomically.
   *
   * @param {object} role - already normalized.
   * @returns {Promise<string>} the file that was written.
   */
  async writeRole(role) {
    const file = roleFile(this.dir, role.id)
    await mkdir(roleDir(this.dir, role.id), { recursive: true })
    await writeFileAtomic(file, `${JSON.stringify(role, null, 2)}\n`)
    return file
  }

  /**
   * Remove one role — its configuration file *and* everything else it owns.
   *
   * "删除角色" has to mean the files go away, because the files are the role:
   * leaving the directory behind would leave a role that looks deleted but
   * still holds an AGENTS.md on disk.
   *
   * @param {string} id
   * @returns {Promise<boolean>} whether anything was removed.
   */
  async remove(id) {
    const index = this.roles.findIndex((role) => role.id === id)
    if (index < 0) return false
    // Delete from disk first (§5.58 A3): dropping it from memory first hid the
    // role while its directory — and its `AGENTS.md` — was still on disk.
    await this.deleteRoleDirOf(id)
    this.roles.splice(index, 1)
    return true
  }

  /** Write the index atomically: a crash never leaves a half-written file. */
  async save() {
    if (this.loadError !== null) {
      throw new Error(`拒绝覆盖无法解析的角色文件（${this.file}）：${this.loadError}`)
    }
    await mkdir(this.dir, { recursive: true })
    const index = { version: VERSION, settings: this.settings }
    await writeFileAtomic(this.file, `${JSON.stringify(index, null, 2)}\n`)
  }
}
