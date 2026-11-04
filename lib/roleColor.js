/**
 * 角色自己的颜色（§5.59）。
 *
 * 用户 2026-10-13（m00378）：「每个角色分配一个颜色…现有角色直接给 json 里面写一个颜色，
 * 新角色也是自动写，不用在界面配置里面展示这个配置」。所以颜色是角色文件的一个属性，
 * 存在 `<roleDir>/role.json` 的 `color` 字段里，和 `mode` / `capabilities` 同级 ——
 * 谁也不需要去别处查表，删角色就跟着目录一起没了。
 *
 * 调色板是固定的十个深色：底色要够深，白字才读得清；十个够一台机器上的角色各不相同。
 * `nextRoleColor` 先挑没被别的角色占用的那一个（两人不同色），全被占满时按 id 稳定散列，
 * 所以任何角色在任何时候都有一个确定且稳定的颜色。
 *
 * @module dsh-agent-team-roles/roleColor
 */

/** 团队 Lead 的颜色（用户 m00378：Lead 固定深紫）。**不在**下面的调色板里，所以角色拿不到它。 */
const LEAD_COLOR = '#6B21A8'

/** 十个深色，顺序即分配顺序；新增颜色只能追加，不能改动已有顺序。 */
const ROLE_PALETTE = [
  '#1D4ED8',
  '#0F766E',
  '#B91C1C',
  '#C2410C',
  '#A21CAF',
  '#4338CA',
  '#15803D',
  '#0369A1',
  '#9D174D',
  '#4D7C0F',
]

/** `#RRGGBB`，不认 `#RGB` / 颜色名：文件里的值必须是规范形式，否则每次载入都会漂。 */
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

/**
 * 把任意输入压成一个规范颜色，或空串。
 *
 * @param {unknown} value
 * @returns {string} `#RRGGBB`（大写），非法或缺失时为空串。
 */
function normalizeColor(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (COLOR_PATTERN.test(text) !== true) return ''
  return `#${text.slice(1).toUpperCase()}`
}

/**
 * 一个稳定散列：同一个 id 永远同一个颜色，不依赖角色表里都有谁。
 *
 * @param {unknown} id
 * @param {string[]} [palette]
 * @returns {string}
 */
function colorForRoleId(id, palette = ROLE_PALETTE) {
  const source = String(id ?? '')
  let hash = 0
  for (const character of source) hash = (hash * 31 + character.codePointAt(0)) >>> 0
  return palette[hash % palette.length]
}

/**
 * 给一个角色挑颜色：先挑当前没人用的那一个，其次才是散列。
 *
 * @param {object[]} roles - 现存的全部角色（含该角色自己；它自己会被排除）。
 * @param {string} id
 * @param {string[]} [palette]
 * @returns {string}
 */
function nextRoleColor(roles, id, palette = ROLE_PALETTE) {
  const used = new Set()
  for (const role of Array.isArray(roles) ? roles : []) {
    if (role === null || typeof role !== 'object') continue
    if (String(role.id ?? '') === String(id ?? '')) continue
    const color = normalizeColor(role.color)
    if (color.length > 0) used.add(color)
  }

  const free = palette.find((candidate) => used.has(normalizeColor(candidate)) !== true)
  return free ?? colorForRoleId(id, palette)
}

export { LEAD_COLOR, ROLE_PALETTE, colorForRoleId, nextRoleColor, normalizeColor }
