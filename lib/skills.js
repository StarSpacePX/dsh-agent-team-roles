/**
 * 角色的技能选择（inherit / pick）。
 *
 * inherit（默认）是用模式 skill-filesystem 行在部署常规根目录里发现的技能；pick 是显式列表。
 * 选择用那一行已有的两个旋钮表达（includeDefaultRoots + customSkillDirs），不新增行也不新增字段。
 *
 * @module dsh-agent-team-roles/skills
 */
import { parseSkillHeader, scanSkills, skillRoots } from './skillScan.js'

/** 发现本地技能的那一行。 */
export const SKILL_ROW_ID = 'skill-filesystem'
/** 把技能暴露给模型的那一行；没有它，发现等于不可见。 */
export const SKILL_TOOL_ROW_ID = 'tool-skill'
/** 两行挂载的包名。 */
export const SKILL_PLUGIN_NAME = '@deepseek-ai/dsh-skill-filesystem'
export const SKILL_TOOL_PLUGIN_NAME = '@deepseek-ai/dsh-tool-skill'
/** 技能目录必须带的文件。 */
export const SKILL_FILE = 'SKILL.md'
/** 存储的角色可能的两种技能模式。 */
export const SKILL_MODES = ['inherit', 'pick']

/** @returns {{ mode: 'inherit' | 'pick', ids: string[] }} */
export function defaultSkills() {
  return { mode: 'inherit', ids: [] }
}

/** 校验来自磁盘或界面的技能块：载入与写入都跑，未知键直接丢掉，否则会一直回写。
 * 即使 inherit 模式也保留 ids，切到 inherit 再切回来不会丢用户的勾选。
 * @param {unknown} input @returns {{ mode: 'inherit' | 'pick', ids: string[] }} */
export function normalizeSkills(input) {
  const out = defaultSkills()
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return out
  const raw = /** @type {Record<string, unknown>} */ (input)

  const mode = String(raw.mode ?? '').trim()
  if (SKILL_MODES.includes(mode)) out.mode = /** @type {'inherit' | 'pick'} */ (mode)

  if (Array.isArray(raw.ids)) {
    for (const value of raw.ids) {
      const name = String(value ?? '').trim()
      if (name.length === 0 || name.length > 80) continue
      if (!out.ids.includes(name)) out.ids.push(name)
    }
  }

  return out
}

/** 把每个角色选的技能名解析成行要指向的目录。
 * 磁盘上已经不存在的名字丢掉并上报：角色保留意图，组合只挂存在的东西，
 * 所以卸掉一个技能退化成本轮不挂载，而不是把预设弄坏。
 * @param {object[]} roles @param {{ skills?: object[] }} scan
 * @returns {Map<string, { dirs: string[], missing: string[] }>} */
export function resolveRoleSkillDirs(roles, scan) {
  const byName = new Map()
  for (const skill of scan?.skills ?? []) if (!byName.has(skill.name)) byName.set(skill.name, skill)

  const out = new Map()
  for (const role of roles ?? []) {
    const skills = normalizeSkills(role?.skills)
    if (skills.mode !== 'pick') continue
    const dirs = []
    const missing = []
    for (const name of skills.ids) {
      const skill = byName.get(name)
      if (skill === undefined) {
        missing.push(name)
        continue
      }
      if (!dirs.includes(skill.dir)) dirs.push(skill.dir)
    }
    out.set(String(role.id), { dirs, missing })
  }
  return out
}

/** 把角色的 skill-filesystem 行指向它选的技能：覆盖已有行的 config，只用这一行已有的两个键。
 * 用户手写的 customSkillDirs / includeDefaultRoots 优先，手写角色不会被静默改写。
 * @param {object} role @param {string[]} dirs @returns {object | null} */
export function withSkillDirs(overrides, input, dirs) {
  const skills = normalizeSkills(input)
  if (skills.mode !== 'pick') return overrides

  const existing = overrides[SKILL_ROW_ID]
  const config = existing?.config
  if (config !== undefined && (Object.prototype.hasOwnProperty.call(config, 'customSkillDirs') || Object.prototype.hasOwnProperty.call(config, 'includeDefaultRoots'))) {
    return overrides
  }

  return {
    ...overrides,
    [SKILL_ROW_ID]: {
      ...existing,
      config: { ...config, includeDefaultRoots: false, customSkillDirs: [...dirs] },
    },
  }
}

/** 模式不带技能行时，选技能的角色需要补的行。
 * 今天只有极简模式是这种情况；两行必须成对加，只有发现没有消费者会看起来生效却什么都没变。
 * @param {unknown} input 角色的技能块 @param {string[]} dirs @param {object[]} plugins
 * @returns {object[]} */
export function skillRowsFor(input, dirs, plugins) {
  const skills = normalizeSkills(input)
  if (skills.mode !== 'pick') return []

  const rows = Array.isArray(plugins) ? plugins : []
  const out = []
  if (!rows.some((row) => row?.id === SKILL_ROW_ID)) {
    out.push({
      id: SKILL_ROW_ID,
      name: SKILL_PLUGIN_NAME,
      config: { includeDefaultRoots: false, customSkillDirs: [...dirs] },
    })
  }
  if (!rows.some((row) => row?.id === SKILL_TOOL_ROW_ID)) out.push({ id: SKILL_TOOL_ROW_ID, name: SKILL_TOOL_PLUGIN_NAME })
  return out
}

export { parseSkillHeader, scanSkills, skillRoots }
