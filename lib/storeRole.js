/**
 * 角色的规范化：把来自磁盘或界面的任意输入压成一份白名单文档。
 *
 * normalizeRole 是纯函数、不碰磁盘，所以读入与写入两条路径都复用它；白名单在两边都跑，
 * 丢掉任何字段都会让文件永远到不了不动点。
 *
 * @module dsh-agent-team-roles/storeRole
 */
import { normalizeCapabilities } from './deployment.js'
import { normalizeColor } from './roleColor.js'
import { normalizeSkills } from './skills.js'
import { normalizeMode } from './template.js'

/** preset id 会被加载器消费，必须看起来像包 id。 */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** 部署已经注册的 preset id，角色不能遮蔽它们。 */
const RESERVED_IDS = new Set(['standard', 'cordis', 'minimal', 'ptc'])

/** 校验一个来自磁盘或界面的角色。
 * @param {unknown} input @returns {object} 归一化后的角色 @throws {Error} 无法归一化 */
function normalizeRole(input) {
  if (input === null || typeof input !== 'object') throw new Error('role must be an object')
  const role = /** @type {Record<string, unknown>} */ (input)

  const id = String(role.id ?? '').trim()
  if (!ID_PATTERN.test(id)) {
    throw new Error(`角色 id 必须是 [a-z0-9][a-z0-9-]*，收到：${JSON.stringify(role.id ?? null)}`)
  }
  if (RESERVED_IDS.has(id)) throw new Error(`角色 id 不能是内置 preset：${id}`)

  const name = String(role.name ?? '').trim()
  if (name.length === 0) throw new Error('角色名字不能为空')
  if (name.length > 80) throw new Error('角色名字不能超过 80 个字符')

  const description = String(role.description ?? '').trim()
  if (description.length > 400) throw new Error('角色描述不能超过 400 个字符')

  const order = Number.isFinite(Number(role.order)) ? Number(role.order) : 10

/** 角色基于哪个部署 preset。未知或缺失回落 standard，好让旧版本或手改过的角色仍能加载；
 * set-mode 在走到这里之前已经校验过原始值。
 * @param {unknown} value @returns {string} */
  const mode = normalizeMode(role.mode)

  const overrides = {}
  const raw = role.overrides
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [rowId, value] of Object.entries(raw)) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = {}
      if (typeof value.disabled === 'boolean') entry.disabled = value.disabled
      if (value.config !== null && typeof value.config === 'object' && !Array.isArray(value.config)) {
        entry.config = { ...value.config }
      }
      if (entry.disabled === undefined && entry.config === undefined) continue
      overrides[rowId] = entry
    }
  }

/** capabilities 存的是 standard 快照没有对应行的那个维度（MCP 可见性）。
 * 不放进 overrides：那里的键来自快照的行 id，合成 id 混进去会让「未知键」与「拼错的行」分不清。 */
  const capabilities = normalizeCapabilities(role.capabilities)

/** 角色可用哪些技能。inherit（默认）= 用模式 skill-filesystem 行自己发现的；
 * pick = 只指向 ids 并关掉默认根目录。ids 在切回 inherit 后仍保留，用户的勾选不会丢。 */
  const skills = normalizeSkills(role.skills)

/** 这个角色的 AGENTS.md 来自哪里。属于来源信息而不是意图，但必须过白名单
 * 白名单在载入与写入两侧都跑，丢掉它下次保存就没了，文件到不了不动点。 */
  const agentsMd = { source: /** @type {string | null} */ (null), copiedAt: /** @type {string | null} */ (null) }
  const rawAgentsMd = role.agentsMd
  if (rawAgentsMd !== null && typeof rawAgentsMd === 'object' && !Array.isArray(rawAgentsMd)) {
    const incoming = /** @type {Record<string, unknown>} */ (rawAgentsMd)
    if (typeof incoming.source === 'string' && incoming.source.length > 0) agentsMd.source = incoming.source
    if (typeof incoming.copiedAt === 'string' && incoming.copiedAt.length > 0) agentsMd.copiedAt = incoming.copiedAt
  }

/** 写入时间戳属于文档而不属于角色意图，但同样必须过白名单，否则下次保存会被抹掉。 */
  const color = normalizeColor(role.color)

  const normalized = { id, name, description, order, mode, overrides, capabilities, skills, agentsMd }
  if (color.length > 0) normalized.color = color

  if (typeof role.createdAt === 'string' && role.createdAt.length > 0) normalized.createdAt = role.createdAt
  if (typeof role.updatedAt === 'string' && role.updatedAt.length > 0) normalized.updatedAt = role.updatedAt

  return normalized
}

export { ID_PATTERN, RESERVED_IDS, normalizeRole }
