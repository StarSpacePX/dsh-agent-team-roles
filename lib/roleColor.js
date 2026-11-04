/**
 * 角色自己的颜色：存在 <roleDir>/role.json 的 color 字段里，与 mode / capabilities 同级，
 * 删角色就跟着目录一起没了，任何地方都不需要查表。
 *
 * 调色板是十个固定深色（底色够深白字才读得清）：nextRoleColor 先挑没被别的角色占用的，
 * 全被占满时按 id 稳定散列，所以任何角色任何时候都有一个确定且稳定的颜色。
 *
 * @module dsh-agent-team-roles/roleColor
 */

/** 团队 Lead 的固定深紫。不在下面的调色板里，所以角色拿不到它。 */
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

/** 只认 #RRGGBB，不认 #RGB 与颜色名：文件里的值必须是规范形式，否则每次载入都会漂。 */
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

/** 把任意输入压成规范颜色，或空串。
 * @param {unknown} value @returns {string} #RRGGBB（大写），非法或缺失时为空串 */
function normalizeColor(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (COLOR_PATTERN.test(text) !== true) return ''
  return `#${text.slice(1).toUpperCase()}`
}

/** 稳定散列：同一个 id 永远同一个颜色，不依赖角色表里都有谁。
 * @param {unknown} id @param {string[]} [palette] @returns {string} */
function colorForRoleId(id, palette = ROLE_PALETTE) {
  const source = String(id ?? '')
  let hash = 0
  for (const character of source) hash = (hash * 31 + character.codePointAt(0)) >>> 0
  return palette[hash % palette.length]
}

/** 给角色挑颜色：先挑当前没人用的那一个，其次才是散列。
 * @param {object[]} roles 现存全部角色（含自己，会被排除） @param {string} id @param {string[]} [palette]
 * @returns {string} */
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
