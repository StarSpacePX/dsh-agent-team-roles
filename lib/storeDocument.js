/**
 * roles.json 的文档层：版本号、原子写、索引的规范化与排序。
 *
 * 只有纯函数加「写文件」这一个副作用助手，不持有任何目录状态——那些在 RoleStore 里。
 *
 * @module dsh-agent-team-roles/storeDocument
 */
import { rename, rm, writeFile } from 'node:fs/promises'

import { normalizeRole } from './storeRole.js'

const FILE = 'roles.json'
const VERSION = 3

/** 原子写：失败时把临时文件一起清掉。
 * 以前失败会留下 <file>.tmp，数据目录就永远带着它，「删除角色」也会留下残留。
 * @param {string} file @param {string} text @returns {Promise<void>} */
async function writeFileAtomic(file, text) {
  const temporary = `${file}.tmp`
  try {
    await writeFile(temporary, text, 'utf8')
    await rename(temporary, file)
  } catch (failure) {
// 清理失败不能顶掉真正的写入错误：临时文件只是残留，抛出的错误才是诊断。
    await rm(temporary, { force: true }).catch(() => {})
    throw failure
  }
}

/** @returns {{ version: number, roles: object[], settings: { bindMembers: boolean } }} */
function emptyDocument() {
  return { version: VERSION, roles: [], settings: defaultSettings() }
}

/** 文档级开关：放在这里而不是插件配置里，是因为要能在界面随时翻转而不用重启 dsh；
 * 配置文件只在加载时读一次。
 * @returns {{ bindMembers: boolean }} */
export function defaultSettings() {
  return { bindMembers: false }
}

/** @param {unknown} parsed @returns {{ version: number, roles: object[], settings: { bindMembers: boolean } }} */
function normalizeDocument(parsed) {
  if (parsed === null || typeof parsed !== 'object') return emptyDocument()
  const raw = /** @type {Record<string, unknown>} */ (parsed)
  const list = Array.isArray(raw.roles) ? raw.roles : []

  const roles = []
  for (const entry of list) {
    try {
      const role = normalizeRole(entry)
      if (roles.some((other) => other.id === role.id)) throw new Error(`角色 id 重复：${role.id}`)
      roles.push(role)
    } catch {
// 坏角色不能把整个文件带崩，由调用方通过 rejected 上报。
      roles.push({ id: `invalid-${roles.length}`, name: '', description: '', order: 0, overrides: {}, invalid: true })
    }
  }

  const settings = defaultSettings()
  const rawSettings = raw.settings
  if (rawSettings !== null && typeof rawSettings === 'object' && !Array.isArray(rawSettings)) {
    const incoming = /** @type {Record<string, unknown>} */ (rawSettings)
    if (typeof incoming.bindMembers === 'boolean') settings.bindMembers = incoming.bindMembers
  }

  return { version: VERSION, roles, settings }
}

/** 按界面列表顺序排序：先 order，再 id。
 * @param {object[]} roles @returns {object[]} */
function orderRoles(roles) {
  return [...roles].sort((a, b) => {
    const left = Number.isFinite(Number(a.order)) ? Number(a.order) : 10
    const right = Number.isFinite(Number(b.order)) ? Number(b.order) : 10
    if (left !== right) return left - right
    return String(a.id).localeCompare(String(b.id))
  })
}

export { FILE, VERSION, writeFileAtomic, emptyDocument, normalizeDocument, orderRoles }
