/**
 * §5.43 — 名册与角色行的**渲染**（从 `team-roster.js` 抽出来）。
 *
 * 按 `Docs/SPEC/产品质量与效率框架.md` 的"代码结构"判据：这里只回答"这段文字长什么样"
 * （谁在、叫什么、什么状态；每个角色的名字/描述/loop/上下文继承），注册与投递在
 * `team-roster.js`。改措辞只改这一个文件。
 *
 * @module dsh-agent-team-roles/roster-blocks
 */

import { readFileSync } from 'node:fs'
import { memberNameForRole } from './roles.js'
import { DEFAULT_MODE } from './template.js'

/** `<team-roster>` 的引出句——**在标签外**（用户 m17317：标签里只留行，措辞保持原样）。 */
export const ROSTER_INTRO_LINE =
  '你是本会话的 Team Lead（团队里叫 "lead"）。当前成员（名字就是 send_message 的 target，能干什么看下面的角色块）：'

/** `<team-roles>` 的引出句，同样在标签外。 */
export const ROLES_INTRO_LINE =
  '本会话已配置的角色。用 spawn_teammate 新建成员时，`name` 必须用下面「成员名」，成员会自动拿到该角色的 preset（工具、技能、AGENTS.md 都以那份为准）：'

/** The one sentence that turns `@name` into a dispatch, kept next to the roster it belongs to. */
export const ROSTER_ROUTING_LINE =
  '用户消息以 `@成员名` 开头时，把 `@成员名` 之后的原文原样用 send_message 转给该成员，不要自己替他做。'

/**
 * The one sentence that ties a spawned teammate to its role (R1, §5.46).
 *
 * Without it the model invents a name from the role's human name (usually
 * Chinese), which can never match: the runtime constrains `name` to lowercase
 * kebab (`…\dsh-experimental-agent-team\lib\index.js:342`), so a role named
 * 「架构师」 has no expressible homonym and the member silently inherits the
 * Lead's preset.
 */
export const ROSTER_ROLE_LINE =
  '新建成员时，`spawn_teammate` 的 `name` 必须用它对应角色的「成员名」（下面角色行里引号内那个），成员才会确定性拿到那个角色的工具与技能。'

/** 角色还没建成员时那行报的状态（用户 m17306）：岗位配好了、位子上没人。 */
export const ROSTER_VACANT = 'vacant'

/**
 * §5.65 — 通信用两份骨架（用户 m01743/m01746），**正文就是 `templates\通信骨架.md`**：
 * 锚点 `<!-- lead -->` / `<!-- teammate -->` 各切一段，改模板只改那个 md，不改 js。
 */
const SKELETON_URL = new URL('../templates/通信骨架.md', import.meta.url)

/** 读一次，全进程共用；读失败不抛，只在 `SKELETON_READ_ERROR` 里留一条话。 */
const SKELETON = readSkeleton()

/** 骨架文件的读取/解析错误（正常是 null）；宿主半拿它记一条 warning，不拦装配。 */
export const SKELETON_READ_ERROR = SKELETON.error
export const LEAD_DISPATCH_LINES = SKELETON.lead
export const TEAMMATE_REPLY_LINES = SKELETON.teammate

/**
 * 读 `templates\通信骨架.md` 并按锚点切成两段。
 *
 * 读不到/锚点缺失都只返回空段（外加 `error`）——模板是资产，不该让 Lead 的 turn 装配失败。
 *
 * @returns {{ lead: string[], teammate: string[], error: string | null }}
 */
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

/**
 * 段内正文 → 注入用的行数组：去首尾空行、去行尾空白，HTML 注释不注入。
 *
 * @param {string} body - 锚点之后、下一个锚点之前的原文。
 * @returns {string[]}
 */
function bodyLines(body) {
  const lines = body.split('\n').map((line) => line.replace(/\s+$/, ''))
  while (lines.length > 0 && lines[0].trim().length === 0) lines.shift()
  while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) lines.pop()
  return lines.filter((line) => !/^\s*<!--/.test(line))
}

/**
 * Defuse anything that looks like a prompt variable.
 *
 * Every context contribution is run through `interpolate()` before the model
 * sees it, and an unresolvable `{{name}}` **throws**
 * (`…\dsh-system-prompt\lib\index.js:153-177`). The roster carries
 * `spawn_teammate` free text (`description` has no character constraint —
 * `…\dsh-experimental-agent-team\lib\index.js:342` constrains only `name`), so
 * a member described as `{{cwd}}` would take down the Lead's turn at assembly
 * time, outside this module's `try`/`catch`. Splitting the braces keeps the
 * text readable and the grammar quiet.
 *
 * @param {string} text
 * @returns {string}
 */
function neutralBraces(text) {
  return text.replace(/\{\{/g, '{ {')
}

/**
 * A member's name — the key the Lead dispatches to (§5.46), and the only place
 * `spawn_teammate`'s own `description` is **not** repeated (user m17071/m17255).
 *
 * @param {{ name?: unknown, status?: unknown, model?: unknown }} member
 * @returns {string}
 */
function memberName(member) {
  return typeof member.name === 'string' && member.name.length > 0 ? member.name : '(未命名)'
}

function memberStatus(member) {
  return typeof member.status === 'string' && member.status.length > 0 ? member.status : 'unknown'
}

/** A member that has stopped: `:9` says the service reports it as `inactive`. */
function isFinished(member) {
  return memberStatus(member) === 'inactive'
}

/**
 * The role's introduction, verbatim (user m17074: **完整介绍**, never truncated).
 *
 * Text that came from a JSON file can carry newlines; they become spaces so one
 * role or member is always one line, but nothing is cut.
 *
 * @param {unknown} role - a stored role, or `null` when the member has none.
 * @returns {string} the description, or `''`.
 */
function aboutOf(role) {
  if (role === null || typeof role !== 'object') return ''
  const raw = typeof role.description === 'string' ? role.description : ''
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * The role's human name, as the user typed it in the settings page.
 *
 * @param {unknown} role - a stored role, or `null`.
 * @returns {string} the label, or `''`.
 */
function labelOf(role) {
  if (role === null || typeof role !== 'object') return ''
  return typeof role.name === 'string' ? role.name.trim() : ''
}

/**
 * One member row: **name, status, model** — and nothing else.
 *
 * User m17255 settled the duplication: a member *is* its role (the binding is by
 * name, §5.46), so the role's introduction belongs on the **role** line, once.
 * Printing it here too said the same sentence twice in the same turn, and the
 * block is a per-turn snapshot, so the repeat was paid on every assembly.
 *
 * The member's own `spawn_teammate` free text stays out as well (user m17071:
 * 「临时写的 为啥要装你上下文？」).
 *
 * This text is re-materialized as a durable user snapshot whenever it changes
 * (`:11-15`), which is why it is sorted: the snapshot must change because the
 * team changed, not because the service returned rows in another order.
 *
 * @param {object} member - an `agentTeams.listMembers()` row.
 * @returns {string}
 */
function rosterLine(member) {
  const facts = [memberStatus(member)]
  if (typeof member.model === 'string' && member.model.length > 0) facts.push(member.model)
  return `- ${memberName(member)}（${facts.join('，')}）`
}

/**
 * 该角色跑在哪个 loop（preset id）：就是 store 里的 `mode`，没设 = 默认模式。
 *
 * 用户 m17599：角色行要写 `loop: user` 这种形态——loop 名直接来自角色自己的设置，
 * 不用人去描述里手写。
 *
 * @param {unknown} role - a stored role, or `null`.
 * @returns {string}
 */
export function loopOf(role) {
  if (role === null || typeof role !== 'object') return DEFAULT_MODE
  const mode = typeof role.mode === 'string' ? role.mode.trim() : ''
  return mode.length > 0 ? mode : DEFAULT_MODE
}

/**
 * 该角色是否继承主会话上下文（设置页那个勾，R8）。
 *
 * 落在 `tool-subagent` 那行的 `config.provider` 上：`'fork'` = 继承（子代理 fork 主会话），
 * 其余（没有这行 / 被关掉 / 没设 provider）= 不继承。用户 m17599：这一条也要写进角色行，
 * 省得在描述里手写"（不）继承主会话上下文"。
 *
 * @param {unknown} role - a stored role, or `null`.
 * @returns {boolean}
 */
export function inheritsContext(role) {
  if (role === null || typeof role !== 'object') return false
  const overrides = role.overrides === null || typeof role.overrides !== 'object' ? null : role.overrides
  const row = overrides === null ? null : overrides['tool-subagent']
  if (row === null || typeof row !== 'object' || row.disabled === true) return false
  const config = row.config
  return config !== null && typeof config === 'object' && config.provider === 'fork'
}

/**
 * Render one role line (§5.46): the role's human name, the exact member name
 * that makes a spawned teammate take it, and then — user m17599 — three facts in
 * order: **描述 → loop 名 → 是否继承上下文**.
 *
 * The introduction is stated here and nowhere else (a member row is just
 * who-is-here), and the last two segments are *derived* from the role's own
 * settings (`mode` / the `tool-subagent` override), so the settings page's
 * description never has to spell out "继承不继承主会话上下文" by hand.
 *
 * @param {{ name?: unknown, description?: unknown, id?: unknown }} role
 * @param {string} prefix
 * @returns {string}
 */
function roleLine(role, prefix) {
  const label = labelOf(role)
  const shown = label.length > 0 ? label : '(未命名)'
  const about = aboutOf(role)
  const tail = `loop: ${loopOf(role)}，${inheritsContext(role) ? '继承上下文' : '不继承上下文'}`
  const line = `- 「${shown}」 → name 用 "${memberNameForRole(role, prefix)}"`
  const body = about.length === 0 ? tail : `${about}；${tail}`
  return `${line}；${body}`
}

/**
 * The roster text for one turn, or `''` when there is nothing to say.
 *
 * Two facts ride in one contribution: **who exists** (members) and **which
 * roles exist and what name each one answers to** (roles). The second is what
 * makes role binding deterministic (§5.46), and it matters *before* the first
 * member exists — so the block no longer disappears just because the team is
 * still empty (an empty roster with no roles yet still contributes nothing).
 *
 * @param {unknown} members - `agentTeams.listMembers()` rows.
 * @param {unknown} [roles] - the stored roles (`store.roles`), or a getter for them.
 * @param {string} [prefix] - the preset id prefix.
 * @returns {string}
 */
export function rosterText(members, roles, prefix) {
  const teammates = (Array.isArray(members) ? members : []).filter(
    (member) => member !== null && typeof member === 'object' && member.role === 'teammate',
  )
  const stored = typeof roles === 'function' ? roles() : roles
  const raws = (Array.isArray(stored) ? stored : []).filter((role) => role !== null && typeof role === 'object')
  const valid = raws.filter((role) => role.invalid !== true)
  const lines = valid.map((role) => roleLine(role, prefix))

  const blocks = []
  // 名册块**永远在**（用户 m17271），但里面**只有行**（用户 m17317）。每个角色一行、
  // 建没建成员都有这一行，没建的只是状态 `vacant`（用户 m17306）——行数不随"建没建"变。
  if (teammates.length > 0 || valid.length > 0) {
    // Every member is spelled out — finished ones included, because the roster
    // owes the Lead their **names** (user m17074), not a `已完成 N 人` count.
    // Sorted so the text depends on the *set* of members, never on the order the
    // service happens to return them in — an unstable order would re-materialize
    // the snapshot without a single real change.
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
