/**
 * RoleStore：一个数据目录上的角色仓库。
 *
 * 磁盘布局
 *   <dir>/roles.json          插件自己的索引（版本 + 设置）
 *   <dir>/<roleId>/role.json  角色自己的配置
 *   <dir>/<roleId>/AGENTS.md  角色的指令文件
 *
 * 一致性顺序是「先磁盘、后内存」：任何一次写失败之后，内存里都不会出现磁盘上不存在的角色。
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
/** @param {string} dir 数据目录 */
  constructor(dir) {
    this.dir = dir
/** 插件自己的索引文件：设置在这里，角色不在。 */
    this.file = path.join(dir, 'roles.json')
    this.document = emptyDocument()
    this.loadError = null
/** 上次载入时从 v1 索引迁出来的角色 id。 */
    this.migrated = []
/** 上次载入时补过颜色的角色 id。 */
    this.colored = []
    this.loaded = false
  }

/** @param {string} id @returns {string} 角色自己的目录。 */
  roleDirOf(id) {
    return roleDir(this.dir, id)
  }

/** @param {string} id @returns {string} 角色的配置文件。 */
  roleFileOf(id) {
    return roleFile(this.dir, id)
  }

/** @param {string} id @returns {string} 角色的指令文件。 */
  agentsMdOf(id) {
    return agentsMdFile(this.dir, id)
  }

/** 删掉一个角色的整个目录。remove 走这里而不是直接调 removeRoleDir，
 * 好让「先磁盘、后内存」在类外可观察、可测试。
 * @param {string} id @returns {Promise<void>} */
  async deleteRoleDirOf(id) {
    await removeRoleDir(this.dir, id)
  }

/** @returns {object[]} */
  get roles() {
    return this.document.roles
  }

/** @returns {{ bindMembers: boolean }} */
  get settings() {
    return this.document.settings ?? defaultSettings()
  }

/** 翻转一个文档级开关并落盘。
 * @param {'bindMembers'} key @param {boolean} value
 * @returns {Promise<{ bindMembers: boolean }>} */
  async setSetting(key, value) {
    const settings = { ...this.settings }
    if (key !== 'bindMembers') throw new Error(`未知设置：${key}`)
    if (typeof value !== 'boolean') throw new Error(`设置 ${key} 必须是布尔值`)
    settings[key] = value
    this.document.settings = settings
    await this.save()
    return settings
  }

/** 从磁盘读全部角色与索引文件。
 * 索引缺失不是错误（新装还没有角色）；角色目录缺失也不是——索引与目录允许不一致，
 * 目录才是用户真正编辑的东西。
 * @returns {Promise<{ version: number, roles: object[], settings: object }>} */
  async load() {
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
// 读不出来的索引不覆写：用户的设置在里头，只是此刻读不了。
        this.loadError = String((error && error.message) || error)
        throw error
      }
    }

    this.document.roles = await this.#readRoles()
    const migrated = []

// v1 → v2：只存在于索引里的角色变成自己的目录；全部写完才重写索引，中断时内联副本仍在。
    for (const entry of legacy) {
      if (typeof entry.id !== 'string' || entry.invalid === true) continue
      if (this.find(entry.id) !== undefined) continue
      try {
        const role = normalizeRole(entry)
        await this.writeRole(role)
        this.document.roles.push(role)
        migrated.push(role.id)
      } catch {
// 归一化失败的内联角色直接丢掉，不复活。
      }
    }

    this.document.roles = orderRoles(this.document.roles)
    this.migrated = migrated

// 老角色没颜色就补一个并写回它自己的 role.json；索引不用动，颜色属于角色。
// 写失败不算载入失败：拿不到颜色只是不显示颜色。
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

/** 读每个子目录里的 <dir>/<roleId>/role.json。
 * @returns {Promise<object[]>} */
  async #readRoles() {
    let entries = []
    try {
      entries = await readdir(this.dir, { withFileTypes: true })
    } catch (error) {
      if (error && error.code === 'ENOENT') return []
      throw error
    }

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
// 读不了的角色文件标成 broken，而不是悄悄消失。
        roles.push({ id: entry.name, name: '', description: '', order: 0, overrides: {}, invalid: true })
      }
    }
    return orderRoles(roles)
  }

/** @param {string} id @returns {object | undefined} */
  find(id) {
    return this.roles.find((role) => role.id === id)
  }

/** 插入或替换一个角色并落盘。
 * @param {unknown} input @returns {Promise<object>} 存储后的角色 */
  async upsert(input) {
    const role = normalizeRole(input)
    const index = this.roles.findIndex((existing) => existing.id === role.id)
    const stamped = {
      ...role,
      createdAt: index >= 0 ? this.roles[index].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
// 新角色自动分配颜色；同一次 upsert 也覆盖磁盘上老角色还没补色的情况，分配逻辑只此一处。
    if (typeof stamped.color !== 'string' || stamped.color.length === 0) {
      stamped.color = nextRoleColor(this.roles, stamped.id)
    }
// 先落盘再改内存：反过来会在写失败时留下一个只存在于内存的角色。
    await this.writeRole(stamped)
    if (index >= 0) this.roles[index] = stamped
    else this.roles.push(stamped)
    this.document.roles = orderRoles(this.roles)
    return stamped
  }

/** 给角色换 id（详情面板「角色 ID」保存时走这里）。
 * id 同时是目录名、role.json 里的字段与注册用的 preset id，三者按序一起改。
 * @param {string} from @param {string} to @returns {Promise<object>} */
  async rename(id, nextId) {
    const index = this.roles.findIndex((role) => role.id === id)
    if (index < 0) throw new Error(`角色不存在：${id}`)
    if (this.roles.some((role) => role.id === nextId)) throw new Error(`角色已存在：${nextId}`)

    const renamed = normalizeRole({ ...this.roles[index], id: nextId })
// 目录先改、文件后改，内存跟随两者；文件写失败就把目录改回去，磁盘与内存仍指同一个 id。
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

/** 原子写一个角色的配置文件。
 * @param {object} role 已归一化 @returns {Promise<string>} 写出的文件路径 */
  async writeRole(role) {
    const file = roleFile(this.dir, role.id)
    await mkdir(roleDir(this.dir, role.id), { recursive: true })
    await writeFileAtomic(file, `${JSON.stringify(role, null, 2)}\n`)
    return file
  }

/** 删除一个角色及其所有文件：文件就是角色，留下目录会留下一个看似已删、仍有 AGENTS.md 的角色。
 * @param {string} id @returns {Promise<boolean>} 是否删掉了东西 */
  async remove(id) {
    const index = this.roles.findIndex((role) => role.id === id)
    if (index < 0) return false
// 先删磁盘：先删内存会让角色先消失，而它的目录与 AGENTS.md 还在。
    await this.deleteRoleDirOf(id)
    this.roles.splice(index, 1)
    return true
  }

/** 原子写索引：崩溃也不会留下半个文件。 */
  async save() {
    if (this.loadError !== null) {
      throw new Error(`拒绝覆盖无法解析的角色文件（${this.file}）：${this.loadError}`)
    }
    await mkdir(this.dir, { recursive: true })
    const index = { version: VERSION, settings: this.settings }
    await writeFileAtomic(this.file, `${JSON.stringify(index, null, 2)}\n`)
  }
}
