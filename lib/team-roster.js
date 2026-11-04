/**
 * Team Lead 的成员名册：成员是谁、此刻叫什么。团队里只有 Lead 知道全貌。
 *
 * dsh 自带的部分只告诉队员「Lead 是谁」，反过来那份名单没人提供，而这个名单在会话期间
 * 会变，所以每次装配都现读；读不到就当没有，绝不抛错——抛错会让提示词装配失败。
 *
 * @module dsh-agent-team-roles/team-roster
 */

import {
  LEAD_DISPATCH_LINES,
  ROLES_INTRO_LINE,
  ROSTER_INTRO_LINE,
  ROSTER_ROLE_LINE,
  ROSTER_ROUTING_LINE,
  ROSTER_VACANT,
  SKELETON_READ_ERROR,
  TEAMMATE_REPLY_LINES,
  inheritsContext,
  loopOf,
  rosterText,
} from './roster-blocks.js'

// 兼容老调用点：这些名字从这里转发，名字与形状不变。
export {
  LEAD_DISPATCH_LINES,
  ROLES_INTRO_LINE,
  ROSTER_INTRO_LINE,
  ROSTER_ROLE_LINE,
  ROSTER_ROUTING_LINE,
  ROSTER_VACANT,
  SKELETON_READ_ERROR,
  TEAMMATE_REPLY_LINES,
  inheritsContext,
  loopOf,
  rosterText,
} from './roster-blocks.js'

/** 名册上下文贡献的稳定名字。 */
export const ROSTER_CONTEXT_NAME = 'agent-team-roles:roster'

/** 排在部署自带上下文之后（110 / 115 / 120）。 */
export const ROSTER_CONTEXT_ORDER = 130

/** 一个在跑的 agent 是不是 Team Lead：tryMembership 不抛错，
 * 普通子代理或过期身份返回 undefined，正是「不是成员、别管它」。
 * @param {any} teams @param {any} agent @returns {boolean} */
export function isLead(teams, agent) {
  return membershipRole(teams, agent) === 'lead'
}

/** 一个在跑的 agent 是不是队员。
 * @param {any} teams @param {any} agent @returns {boolean} */
export function isTeammate(teams, agent) {
  return membershipRole(teams, agent) === 'teammate'
}

/** 一个在跑 agent 的成员角色；不是成员返回 undefined。
 * @param {any} teams @param {any} agent @returns {string | undefined} */
function membershipRole(teams, agent) {
  if (teams === undefined || teams === null || typeof teams.tryMembership !== 'function') return undefined
  try {
    const membership = teams.tryMembership(agent)
    if (membership === null || typeof membership !== 'object') return undefined
    return typeof membership.role === 'string' ? membership.role : undefined
  } catch {
    return undefined
  }
}

/** 成员收到的回报骨架。只改这里，不加细则，也不写进任何角色的 AGENTS.md。 */
export const TEAMMATE_STYLE_LINE = TEAMMATE_REPLY_LINES.join('\n')

/** 队员聊天风格贡献的稳定名字。 */
export const STYLE_CONTEXT_NAME = 'agent-team-roles:chat-style'

/** 在一个队员的作用域上注册单行聊天风格。
 * @param {any} agent @returns {(() => void) | null} systemPrompt.context() 的 disposer */
export function installTeammateStyle(agent) {
  const scoped = agent === null || agent === undefined ? undefined : agent.ctx
  const prompt = scoped === null || scoped === undefined ? undefined : scoped.systemPrompt
  if (prompt === null || prompt === undefined || typeof prompt.context !== 'function') return null
  return prompt.context({ name: STYLE_CONTEXT_NAME, order: ROSTER_CONTEXT_ORDER, text: TEAMMATE_STYLE_LINE })
}

/** 在一个 agent 的作用域上注册名册。
 * provider 永不抛错：抛错会让提示词装配失败、弄崩 Lead 的 turn，读不到的名册贡献空。
 * @param {any} agent @param {any} teams @param {(error: unknown) => void} onError
 * @returns {(() => void)} */
export function installRoster(agent, teams, onError, options) {
  const scoped = agent === null || agent === undefined ? undefined : agent.ctx
  const prompt = scoped === null || scoped === undefined ? undefined : scoped.systemPrompt
  if (prompt === null || prompt === undefined || typeof prompt.context !== 'function') return null

  const settings = options === null || options === undefined ? {} : options

  const read = () => {
    try {
      const members = teams.listMembers(agent)
      return rosterText(members, settings.roles, settings.prefix)
    } catch (error) {
      if (typeof onError === 'function') onError(error)
      return ''
    }
  }

  return prompt.context({ name: ROSTER_CONTEXT_NAME, order: ROSTER_CONTEXT_ORDER, text: read })
}
