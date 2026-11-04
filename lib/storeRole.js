/**
 * 角色的规范化：把来自磁盘或 UI 的任意输入压成一份白名单文档。
 *
 * 从 `store.js` 拆出（长脚本拆分）。`normalizeRole` 是纯函数，不碰磁盘，
 * 这是它能同时被「读入」和「写入」两条路径复用的原因 —— 白名单在两边都跑，
 * 丢掉任何字段都会让文件永远到不了不动点。
 *
 * @module dsh-agent-team-roles/storeRole
 */
import { normalizeCapabilities } from './deployment.js'
import { normalizeColor } from './roleColor.js'
import { normalizeSkills } from './skills.js'
import { normalizeMode } from './template.js'

/** Preset ids are consumed by the loader, so they must look like package ids. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** Preset ids the deployment already registers; a role must not shadow them. */
const RESERVED_IDS = new Set(['standard', 'cordis', 'minimal', 'ptc'])

/**
 * Validate one role as it arrives from disk or from the UI.
 *
 * @param {unknown} input
 * @returns {{ id: string, name: string, description: string, order: number, mode: string, overrides: object, capabilities: object, skills: { mode: string, ids: string[] }, agentsMd: { source: string | null, copiedAt: string | null }, color?: string, createdAt?: string, updatedAt?: string }}
 * @throws {Error} when the id or name is unusable.
 */
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

  /**
   * Which of the deployment's four agent presets this role is built from
   * (§5.32). Unknown or missing values fall back to `standard` — the mode the
   * user says is the default — so a role file from an older build, or one the
   * user hand-edited, still loads instead of being reported as broken. The
   * `set-mode` action validates the raw value before it ever gets here, so a
   * typo in the UI is still an error rather than a silent reset.
   */
  const mode = normalizeMode(role.mode)

  /** @type {Record<string, { disabled?: boolean, config?: object }>} */
  const overrides = {}
  const raw = role.overrides
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [rowId, value] of Object.entries(raw)) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
      /** @type {{ disabled?: boolean, config?: object }} */
      const entry = {}
      if (typeof value.disabled === 'boolean') entry.disabled = value.disabled
      if (value.config !== null && typeof value.config === 'object' && !Array.isArray(value.config)) {
        entry.config = { ...value.config }
      }
      if (entry.disabled === undefined && entry.config === undefined) continue
      overrides[rowId] = entry
    }
  }

  /**
   * `capabilities` holds the one dimension the `standard` snapshot has no row
   * for (MCP visibility). It is stored next to `overrides` rather than inside it
   * because it is not a template row: the row ids `overrides` is keyed by come
   * from the snapshot, and letting a synthetic id (`mcp:github`) live in the same
   * map would make an unknown key indistinguishable from a mistyped row.
   *
   * The normalizer also retires the `loop` block an older role file carries
   * (§5.30): a role cannot own an `agent-loop` row, so there is nothing to keep.
   */
  const capabilities = normalizeCapabilities(role.capabilities)

  /**
   * §5.47 — which skills this role may use. `inherit` (the default) means "what
   * the mode's `skill-filesystem` row finds on its own"; `pick` points that row
   * at exactly `ids` and turns the default roots off. The ids survive a switch
   * back to `inherit` so the user's selection is never lost by a toggle.
   */
  const skills = normalizeSkills(role.skills)

  /**
   * Where this role's `AGENTS.md` came from. It is provenance rather than
   * intent, but it still has to survive this whitelist: the whitelist runs on
   * load as well as on write, so dropping it here would erase it on the next
   * save and leave the file unable to reach a fixpoint.
   */
  const agentsMd = { source: /** @type {string | null} */ (null), copiedAt: /** @type {string | null} */ (null) }
  const rawAgentsMd = role.agentsMd
  if (rawAgentsMd !== null && typeof rawAgentsMd === 'object' && !Array.isArray(rawAgentsMd)) {
    const incoming = /** @type {Record<string, unknown>} */ (rawAgentsMd)
    if (typeof incoming.source === 'string' && incoming.source.length > 0) agentsMd.source = incoming.source
    if (typeof incoming.copiedAt === 'string' && incoming.copiedAt.length > 0) agentsMd.copiedAt = incoming.copiedAt
  }

  /**
   * The write stamps are part of the document, not of the role's *intent*, but
   * they still have to survive this whitelist: it runs on load as well as on
   * write, so dropping them here would erase them on the next save and leave the
   * file unable to reach a fixpoint.
   *
   * @type {{ id: string, name: string, description: string, order: number, mode: string, overrides: object, capabilities: object, skills: { mode: string, ids: string[] }, agentsMd: { source: string | null, copiedAt: string | null }, color?: string, createdAt?: string, updatedAt?: string }}
   */
  /**
   * §5.59 — 角色自己的颜色。这里只做规范化：缺失或非法一律留空，由 `RoleStore` 在载入
   * 或保存时补一个（`nextRoleColor`）。所以「老角色也要有颜色」不用用户动任何文件，
   * 而一个手写的 `"color": "紫"` 也不会把整份角色文件变成损坏。
   */
  const color = normalizeColor(role.color)

  const normalized = { id, name, description, order, mode, overrides, capabilities, skills, agentsMd }
  if (color.length > 0) normalized.color = color

  if (typeof role.createdAt === 'string' && role.createdAt.length > 0) normalized.createdAt = role.createdAt
  if (typeof role.updatedAt === 'string' && role.updatedAt.length > 0) normalized.updatedAt = role.updatedAt

  return normalized
}

export { ID_PATTERN, RESERVED_IDS, normalizeRole }
