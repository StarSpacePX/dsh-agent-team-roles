/**
 * 名册与角色行的渲染：只决定这段文字长什么样（谁在、叫什么、什么状态），
 * 注册与投递在 team-roster.js。改措辞只改这一个文件。
 *
 * @module dsh-agent-team-roles/roster-blocks
 */

import { readFileSync } from 'node:fs'
import { memberNameForRole } from './roles.js'
import { DEFAULT_MODE } from './template.js'

/** <team-roster> 的引出句，放在标签外：标签里只留行。 */
export const ROSTER_INTRO_LINE =
  '你是本会话的 Team Lead（团队里叫 "lead"）。当前成员（名字就是 send_message 的 target，能干什么看下面的角色块）：'

/** <team-roles> 的引出句，同样放在标签外。 */
export const ROLES_INTRO_LINE =
  '本会话已配置的角色。用 spawn_teammate 新建成员时，`name` 必须用下面「成员名」，成员会自动拿到该角色的 preset（工具、技能、AGENTS.md 都以那份为准）：'

/** 把 @name 变成一次派发的那一句，跟名册放在一起。 */
export const ROSTER_ROUTING_LINE =
  '用户消息以 `@成员名` 开头时，把 `@成员名` 之后的原文原样用 send_message 转给该成员，不要自己替他做。'

/** 把新建成员绑到它那个角色的那一句。
 * 没有它，模型会拿中文角色名当成员名，而运行时只认小写 kebab，永远匹配不上。
 * @returns {string} */
export const ROSTER_ROLE_LINE =
  '新建成员时，`spawn_teammate` 的 `name` 必须用它对应角色的「成员名」（下面角色行里引号内那个），成员才会确定性拿到那个角色的工具与技能。'

/** 角色还没成员时的状态：岗位配好了、位子上没人。 */
export const ROSTER_VACANT = 'vacant'

/** 通信用两份骨架，正文就是 templates/通信骨架.md：按 <!-- lead --> / <!-- teammate -->
 * 锚点切段，改模板只改那个 md，不改 js。 */
const SKELETON_URL = new URL('../templates/通信骨架.md', import.meta.url)

/** 读一次，全进程共用；读失败不抛，只留一条错误。 */
const SKELETON = readSkeleton()

/** 骨架读取或解析错误（正常为 null）；宿主侧据此记 warning，不拦装配。 */
export const SKELETON_READ_ERROR = SKELETON.error
export const LEAD_DISPATCH_LINES = SKELETON.lead
export const TEAMMATE_REPLY_LINES = SKELETON.teammate

/** 读 templates/通信骨架.md 并按锚点切成两段；读不到或缺锚点只返回空段，
 * 不能让 Lead 的 turn 装配失败。
 * @returns {{ lead: string[], teammate: string[], error: string | null }} */
function readSkeleton() {
  const empty = { lead: [], teammate: [], error: null }
  let text
  try {
    text = readFileSync(SKELETON_URL, 'utf8')
  } catch (cause) {
    return { ...empty, error: `通信骨架读不到：${String((cause && cause.message) || cause)}` }
  }
  const parts = text.split(/^<!--\s*(lead|teammate)\s*-->\s*$/m)
  const out = { lead: [], teammate: [], error: null }
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const key = parts[i].trim()
    if (key !== 'lead' && key !== 'teammate') continue
    out[key] = bodyLines(parts[i + 1])
  }
  if (out.lead.length === 0 && out.teammate.length === 0) out.error = '通信骨架里没有 lead/teammate 锚点'
  return out
}

/** 段内正文转成注入用的行数组：去首尾空行与行尾空白，HTML 注释不注入。
 * @param {string} body @returns {string[]} */
function bodyLines(body) {
  const lines = body.split('\n').map((line) => line.replace(/\s+$/, ''))
  while (lines.length > 0 && lines[0].trim().length === 0) lines.shift()
  while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) lines.pop()
  return lines.filter((line) => !/^\s*<!--/.test(line))
}

/** 去掉一切像提示词变量的内容：每段上下文都会过 interpolate()，
 * 解析不了的 {{name}} 会直接抛错。
 * @param {string} text @returns {string} */
function neutralBraces(text) {
  return text.replace(/\{\{/g, '{ {')
}

/** 成员名：Lead 派发用的键，也是成员行不重复 spawn_teammate description 的地方。
 * @param {{ name?: unknown, status?: unknown, model?: unknown }} member @returns {string} */
function memberName(member) {
  return typeof member.name === 'string' && member.name.length > 0 ? member.name : '(未命名)'
}

function memberStatus(member) {
  return typeof member.status === 'string' && member.status.length > 0 ? member.status : 'unknown'
}

/** 已停止的成员：服务报的状态是 inactive。 */
function isFinished(member) {
  return memberStatus(member) === 'inactive'
}

/** 角色的介绍原文，完整不截断；JSON 里的换行压成空格，保证一个角色一行。
 * @param {unknown} role @returns {string} */
function aboutOf(role) {
  if (role === null || typeof role !== 'object') return ''
  const raw = typeof role.description === 'string' ? role.description : ''
  return raw.replace(/\s+/g, ' ').trim()
}

/** 角色的人类可读名，即设置页里键入的那个。
 * @param {unknown} role @returns {string} */
function labelOf(role) {
  if (role === null || typeof role !== 'object') return ''
  return typeof role.name === 'string' ? role.name.trim() : ''
}

/** 一行成员：名字、状态、模型，没有别的。
 * 成员就是它的角色（按名字绑定），所以介绍只写在角色行，避免每轮重复一遍。
 * @param {object} member @param {unknown} role @returns {string} */
function rosterLine(member) {
  const facts = [memberStatus(member)]
  if (typeof member.model === 'string' && member.model.length > 0) facts.push(member.model)
  return `- ${memberName(member)}（${facts.join('，')}）`
}

/** 该角色跑在哪个 loop（preset id）：store 里的 mode，没设即默认模式。
 * @param {unknown} role @returns {string} */
export function loopOf(role) {
  if (role === null || typeof role !== 'object') return DEFAULT_MODE
  const mode = typeof role.mode === 'string' ? role.mode.trim() : ''
  return mode.length > 0 ? mode : DEFAULT_MODE
}

/** 该角色是否继承主会话上下文：落在 tool-subagent 行的 config.provider，'fork' 为继承。
 * @param {unknown} role @returns {boolean} */
export function inheritsContext(role) {
  if (role === null || typeof role !== 'object') return false
  const overrides = role.overrides === null || typeof role.overrides !== 'object' ? null : role.overrides
  const row = overrides === null ? null : overrides['tool-subagent']
  if (row === null || typeof row !== 'object' || row.disabled === true) return false
  const config = row.config
  return config !== null && typeof config === 'object' && config.provider === 'fork'
}

/** 一行角色：人类名、能绑定它的精确成员名，然后依次是描述 → loop 名 → 是否继承上下文。
 * 后两项来自角色自己的设置，不需要在描述里手写。
 * @param {unknown} role @param {string} memberName @returns {string} */
function roleLine(role, prefix) {
  const label = labelOf(role)
  const shown = label.length > 0 ? label : '(未命名)'
  const about = aboutOf(role)
  const tail = `loop: ${loopOf(role)}，${inheritsContext(role) ? '继承上下文' : '不继承上下文'}`
  const line = `- 「${shown}」 → name 用 "${memberNameForRole(role, prefix)}"`
  const body = about.length === 0 ? tail : `${about}；${tail}`
  return `${line}；${body}`
}

/** 某一轮的名册文本；没有可说的返回空串。
 * 两部分：谁存在（成员）与有哪些角色、各自认哪个名字（角色）。
 * @param {object[]} members @param {unknown[]} roles @returns {string} */
export function rosterText(members, roles, prefix) {
  const teammates = (Array.isArray(members) ? members : []).filter(
    (member) => member !== null && typeof member === 'object' && member.role === 'teammate',
  )
  const stored = typeof roles === 'function' ? roles() : roles
  const raws = (Array.isArray(stored) ? stored : []).filter((role) => role !== null && typeof role === 'object')
  const valid = raws.filter((role) => role.invalid !== true)
  const lines = valid.map((role) => roleLine(role, prefix))

  const blocks = []
// 名册块永远在，但里面只有行：每个角色一行，没建成员的只是状态 vacant，行数不随建没建变。
  if (teammates.length > 0 || valid.length > 0) {
// 每个成员都写出来（含已完成的）：名册欠 Lead 的是名字，不是「已完成 N 人」。
// 排序让文本只取决于成员集合，不取决于服务返回顺序。
    const rows = teammates.slice().sort((left, right) => {
      const state = Number(isFinished(left)) - Number(isFinished(right))
      return state !== 0 ? state : memberName(left).localeCompare(memberName(right), 'en')
    })
    const taken = new Set(teammates.map(memberName))
    const vacant = valid
      .map((role) => memberNameForRole(role, prefix))
      .filter((name) => name.length > 0 && !taken.has(name))
      .map((name) => `- ${name}（${ROSTER_VACANT}）`)

    blocks.push(
      [
        ROSTER_INTRO_LINE,
        '<team-roster>',
        ...rows.map(rosterLine),
        ...vacant,
        '</team-roster>',
        ROSTER_ROUTING_LINE,
        '成员之间看不到彼此，只有你知道全部成员。',
        ...LEAD_DISPATCH_LINES,
      ].join('\n'),
    )
  }
  if (lines.length > 0) {
    blocks.push(
      [
        ROLES_INTRO_LINE,
        '<team-roles>',
        ...lines,
        '</team-roles>',
        ROSTER_ROLE_LINE,
      ].join('\n'),
    )
  }

  return neutralBraces(blocks.join('\n'))
}
