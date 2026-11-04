/**
 * 部署自带四种 agent preset 的 id 与显示名，以及把存储的角色变成 dsh 实际挂载的组合行。
 *
 * 组合内容不在这里存副本，每个 mode 的 preset 都从 Loader 现场读；
 * 这里只做「模板行 + 角色覆盖 → 组合行」的纯函数变换。
 */
export const MODES = [
  { id: 'standard', label: '标准模式' },
  { id: 'ptc', label: 'PTC 模式' },
  { id: 'minimal', label: '极简模式' },
  { id: 'cordis', label: '创造模式' },
]

/** 角色没指定基于哪个模式时的默认值。 */
export const DEFAULT_MODE = 'standard'

/** mode id 会当文件名用，可能逃出目录的值在碰到文件系统前就拒绝。 */
const MODE_ID_PATTERN = /^[A-Za-z0-9._-]+$/

export function isModeId(value) {
  return typeof value === 'string' && value !== '' && MODE_ID_PATTERN.test(value)
}

/** 把存储或提交的 mode 归一成 id：非空就原样保留（可能是部署侧任意 preset），只有空或非法才回落 standard。 */
export function normalizeMode(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  if (id === '' || id === DEFAULT_MODE) return DEFAULT_MODE
  return isModeId(id) ? id : DEFAULT_MODE
}

/** 四种自带模式的显示名；其它 preset 返回 id 本身，不能误显示成「标准模式」。
 * @param {string} id @returns {string} */
export function modeLabel(id) {
  const found = MODES.find((mode) => mode.id === normalizeMode(id))
  return found === undefined ? normalizeMode(id) : found.label
}

/** 自带模式的标签；其它 preset 由调用方优先用 registry 的 name。
 * @param {string} id @returns {string | null} */
export function shippedLabel(id) {
  const found = MODES.find((mode) => mode.id === id)
  return found === undefined ? null : found.label
}

/** process.platform === '<literal>'，相等判断。 */
const GATE_EQUALS = /^process\.platform\s*===\s*(['"])(.*?)\1$/
/** process.platform !== '<literal>'，取反。 */
const GATE_NOT_EQUALS = /^process\.platform\s*!==\s*(['"])(.*?)\1$/

/** 把 !!js 标量转成布尔：只认两种平台比较，其余返回 undefined ——
 * 条件判不出的行照常可用，不静默消失。
 * @param {string} expr @param {string} platform
 * @returns {boolean | undefined} */
export function resolveGate(value, platform = process.platform) {
  if (value === null || typeof value !== 'object') return value === true ? true : value === false ? false : undefined
  if (!Object.prototype.hasOwnProperty.call(value, '__js__')) return undefined

  const expression = String(value.__js__).trim()
  const equals = GATE_EQUALS.exec(expression)
  if (equals) return platform === equals[2]
  const notEquals = GATE_NOT_EQUALS.exec(expression)
  if (notEquals) return platform !== notEquals[2]
  return undefined
}

/** 把角色的 config 补丁叠到模板 config 上；补丁里的 null 表示删掉该键。
 * @param {object | undefined} base @param {object | undefined} patch
 * @returns {object | undefined} */
export function applyConfig(base, patch) {
  const baseIsObject = base !== null && typeof base === 'object' && !Array.isArray(base)
  const patchIsObject = patch !== null && typeof patch === 'object' && !Array.isArray(patch)
  if (!baseIsObject && !patchIsObject) return undefined

  const out = baseIsObject ? { ...base } : {}
  for (const [key, value] of Object.entries(patchIsObject ? patch : {})) {
    if (value === null) delete out[key]
    else out[key] = value
  }
  return out
}

/** 行 disabled 字段代表的布尔（覆盖之前）。
 * @param {object} row @param {string} platform @returns {boolean} */
function templateDisabled(row, platform) {
  if (row.disabled === undefined) return false
  const resolved = resolveGate(row.disabled, platform)
  return resolved === undefined ? false : resolved === true
}

/** id/name 推不出维度的行。 */
const CATEGORY_BY_ID = new Map([
// persona 与 agent-instructions 同属「身份 + 规则」一个维度，不算两种。
  ['persona', 'agents-md'],
  ['agent-instructions', 'agents-md'],
  ['skill-filesystem', 'skill'],
  ['tool-skill', 'skill'],
]);

/** 行属于哪个维度（工具/技能/MCP/分组/身份）；不属于任何维度的行按独立行处理。 */
export function categorize(row, isGroup = row.group === true) {
  if (isGroup) return 'group'
  const id = String(row.id ?? '')
  const name = String(row.name ?? '')
  if (CATEGORY_BY_ID.has(id)) return CATEGORY_BY_ID.get(id)
  if (/mcp/i.test(id) || /mcp/i.test(name)) return 'mcp'
  if (/agent-loop|^loop-/.test(id) || /agent-loop/.test(name)) return 'loop'
  if (id.startsWith('skill')) return 'skill'
  if (id.startsWith('tool-')) return 'tool'
  return 'other'
}

/** 唯一能发布全局命名工具的行：同一作用域内最多一个实例能拥有模型选择。 */

/** 由模板行 + 覆盖生成一个角色的组合行。
 * @param {object[]} rows @param {string} platform
 * @param {Record<string, { disabled?: boolean, config?: object }>} [overrides]
 * @returns {object[]} */
export function composeRows(rows, platform, overrides = {}) {
  return rows.map((row) => {
    const isGroup = row.group === true && Array.isArray(row.config)
    const out = { ...row }

    if (isGroup) out.config = composeRows(row.config, platform, overrides)
    else if (row.config !== null && typeof row.config === 'object') out.config = { ...row.config }

    const override = row.id === undefined ? undefined : overrides[row.id]

    if (override && typeof override.disabled === 'boolean') out.disabled = override.disabled
    else if (templateDisabled(row, platform)) out.disabled = true
    else delete out.disabled

    if (!isGroup) {
      const config = applyConfig(row.config, override?.config)
      if (config === undefined) delete out.config
      else out.config = config
    }

    return out
  })
}

/** 把模板拍平成界面渲染的行列表；组合行的 key 用裸行 id，与 overrides 的键一致。 */
export function describeRows(rows, platform, overrides = {}, parent = null) {
  const out = []

  for (const row of rows) {
    const isGroup = row.group === true && Array.isArray(row.config)
    const id = row.id === undefined ? null : String(row.id)
    const path = parent === null ? id : `${parent}/${id}`
    const override = id === null ? undefined : overrides[id]
    const overrideDisabled = typeof override?.disabled === 'boolean' ? override.disabled : null

    out.push({
      id,
      path,
      parent,
      name: row.name ?? null,
      group: isGroup,
      category: categorize(row, isGroup),
      templateDisabled: templateDisabled(row, platform),
      disabled: overrideDisabled === null ? templateDisabled(row, platform) : overrideDisabled,
      hasOverride: Boolean(override && (typeof override.disabled === 'boolean' || override.config)),
      configurable: !isGroup,
      templateConfig: !isGroup && row.config && typeof row.config === 'object' ? row.config : null,
      config: isGroup ? null : (applyConfig(row.config, override?.config) ?? null),
      isolate: isGroup ? (row.isolate ?? null) : null,
    })

    if (isGroup) out.push(...describeRows(row.config, platform, overrides, path))
  }

  return out
}
