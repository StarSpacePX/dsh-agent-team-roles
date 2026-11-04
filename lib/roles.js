/**
 * 把存储的角色变成 agent preset 定义。
 *
 * 角色只存意图；挂载用的组合每次按它声明的 mode 从实时声明重组，
 * 所以 dsh 升级时模板行跟着部署走，角色自己的决定保持不变。
 *
 * @module dsh-agent-team-roles/roles
 */
import { INSTRUCTION_ROW_ID, buildMcpGateRow, buildToolGateRow, defaultCapabilities, normalizeCapabilities } from './deployment.js'
import { defaultSkills, skillRowsFor, withSkillDirs } from './skills.js'
import { DEFAULT_MODE, composeRows, modeLabel, normalizeMode } from './template.js'

/** 顺序值只表示相对大小，与自带 preset 的 1..4 无关。 */
const DEFAULT_ORDER = 10

/** 角色在 mode 快照之上额外加的行：MCP 与插件工具两个维度在自带 preset 里没有可切的行，只能由角色自己声明。 */
function capabilityRows(role) {
  const capabilities = normalizeCapabilities(role.capabilities)

  const rows = []

  const gate = buildMcpGateRow(capabilities.mcp.deny)
  if (gate !== null) rows.push(gate)

  const toolGate = buildToolGateRow(capabilities.toolGate.deny)
  if (toolGate !== null) rows.push(toolGate)

  return rows
}

/** 把角色的指令行指向角色自己的目录：行里 dshHome 设成角色目录，
 * dsh-agent-instructions 就会把 <roleDir>/AGENTS.md 当用户全局文件加载。 */
export function withInstructionHome(overrides, home) {
  const target = typeof home === 'string' ? home.trim() : ''
  if (target.length === 0) return overrides

  const existing = overrides[INSTRUCTION_ROW_ID]
  const pinned = existing?.config?.dshHome
// 只有指向别处的 dshHome 才算用户主张；null / 空串是「删键」不是「别写」，按没有主张处理。
// 否则同一份 AGENTS.md 注入两遍：角色目录就在 ~/.dsh 里，跨目录上游不去重。
  if (typeof pinned === 'string' && pinned.trim().length > 0) return overrides

  return {
    ...overrides,
    [INSTRUCTION_ROW_ID]: { ...existing, config: { ...existing?.config, dshHome: target } },
  }
}

/** 取角色要组合的快照：函数按 mode 现取（真实路径），对象是测试用的固定快照。
 * @param {object | ((mode: string) => object)} templateOf
 * @returns {(mode: string) => object} */
function resolveTemplate(templateOf, mode) {
  return typeof templateOf === 'function' ? templateOf(mode) : templateOf
}

/** 生成一个角色的 preset 定义。
 * @param {object} role @param {object | ((mode: string) => object)} templateOf
 * @param {string} [platform] @param {object} [options] @returns {object} */
export function buildDefinition(role, templateOf, platform = process.platform, options = {}) {
  const home = typeof options.dirOf === 'function' ? options.dirOf(role.id) : ''
  const skillDirs = typeof options.skillDirOf === 'function' ? options.skillDirOf(role.id) : []
  const snapshot = resolveTemplate(templateOf, normalizeMode(role.mode))

  return {
    id: role.id,
    name: role.name,
    description: role.description || `agent team 角色（模板：${snapshot.source?.presetId ?? DEFAULT_MODE}）`,
    order: Number.isFinite(role.order) ? role.order : DEFAULT_ORDER,
    plugins: [
      ...composeRows(
        snapshot.plugins,
        platform,
        withSkillDirs(withInstructionHome(role.overrides ?? {}, home), role.skills, skillDirs),
      ),
      ...capabilityRows(role),
// 极简模式没有技能行，选技能的极简角色补一对；其它模式靠上面重写已有行。
      ...skillRowsFor(role.skills, skillDirs, snapshot.plugins),
    ],
  }
}

/** 生成全部角色的定义；坏角色跳过，不中断整轮注册。
 * @param {object[]} roles @param {object | ((mode: string) => object)} templateOf
 * @param {string} [platform] @param {object} [options]
 * @returns {{ definitions: object[], skipped: { id: string, reason: string }[] }} */
export function buildDefinitions(roles, templateOf, platform = process.platform, options = {}) {
  const definitions = []
  const skipped = []

  for (const role of roles) {
    if (role.invalid === true) {
      skipped.push({ id: String(role.id ?? '<unknown>'), reason: '角色条目损坏，已跳过' })
      continue
    }
    try {
      definitions.push(buildDefinition(role, templateOf, platform, options))
    } catch (error) {
      skipped.push({ id: String(role.id ?? '<unknown>'), reason: String((error && error.message) || error) })
    }
  }

  return { definitions, skipped }
}

/** 新角色：先用某个 mode 的快照填满，界面能立刻看到完整能力表。
 * @param {string} id @param {string} name @param {object} template
 * @param {string} [mode] @returns {object} */
export function createRole(id, name, template, mode) {
  const selected = normalizeMode(mode ?? template?.source?.presetId)
  return {
    id,
    name,
    description: `以 ${modeLabel(selected)} 为模板的角色`,
    order: DEFAULT_ORDER,
    mode: selected,
    overrides: {},
    capabilities: defaultCapabilities(),
// 新角色默认继承 mode 的技能，直到用户自己选。
    skills: defaultSkills(),
  }
}

/** 由角色名派生 preset id：纯 ASCII 走 slug，中文名取稳定哈希，避免都落到空串上撞车。
 * @param {string} name @param {string} prefix @returns {string} */
export function slugify(name, prefix) {
  const ascii = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  let slug = ascii
  if (slug.length === 0) {
    let hash = 0
    for (const character of String(name ?? '')) hash = (hash * 31 + character.codePointAt(0)) >>> 0
    slug = `r${hash.toString(36)}`
  }

  const trimmed = slug.slice(0, 40).replace(/-+$/, '')
  return `${prefix}${trimmed}`
}

/** 该角色对应的成员名：preset id 去掉前缀即可，用 id 而不是重新 slug 名，中文角色名才稳定。 */
export function memberNameForRole(role, prefix) {
  const id = String((role === null || role === undefined ? '' : role.id) ?? '')
  const tag = String(prefix ?? '')
  return tag.length > 0 && id.startsWith(tag) ? id.slice(tag.length) : id
}

/** 按 Team 运行时记录的成员名反查角色：名字是确定性事实，descriptor 的 label 不可靠。 */
export function roleForMemberName(roles, name, prefix) {
  if (!Array.isArray(roles)) return undefined
  const wanted = String(name ?? '').trim().toLowerCase()
  if (wanted.length === 0) return undefined
  return roles.find((role) => {
    if (role === null || typeof role !== 'object' || role.invalid === true) return false
    if (String(role.id ?? '').toLowerCase() === wanted) return true
    const bare = memberNameForRole(role, prefix).toLowerCase()
    return bare.length > 0 && bare === wanted
  })
}
