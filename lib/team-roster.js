/**
 * §5.43 — the Team Lead's member roster.
 *
 * The user's rule (m10481): **the Lead is the only member who knows the whole
 * team.** A teammate's own initial prompt already names the Lead
 * (`…\dsh-experimental-tool-agent-team\lib\index.js:276-284`); what no part of
 * dsh supplies is the reverse list — who exists, and what they are called
 * right now. That list changes while the session runs (members spawn, finish,
 * appear as `inactive`), so it is a runtime fact, not static text.
 *
 * `systemPrompt.context()` is exactly that mechanism
 * (`…\dsh-system-prompt\lib\types\index.d.ts:71-79`): `text` may be a provider
 * evaluated at every assembly, the result is materialized as a durable
 * user-role snapshot, and the loop only appends it again once the text
 * actually changed. `systemPrompt.section()` would freeze it at load time.
 *
 * The contribution is registered on `agent.ctx` — one exact agent's scope — so
 * it is invisible to everybody else: a scoped contribution belongs to the
 * scope that registered it (`…\dsh-subagent\lib\types\child-agent.js:135-140`).
 *
 * `CONTEXT_ORDERS` is a closed enum in the deployment
 * (`…\dsh-system-prompt\lib\index.js:44-48`: SANDBOX_POLICY 110,
 * APPROVAL_POLICY 115, SUBAGENT_DELEGATION 120) with no slot for plugins, so
 * this contribution carries its own finite order just after those three; the
 * service only requires the number to be finite (`…\lib\index.js:266-268`).
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

// 兼容：老调用点（与测试）一直是从这个模块拿这些名字的，改成转发，名字与形状不变。
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

/** Stable name of the roster context contribution. */
export const ROSTER_CONTEXT_NAME = 'agent-team-roles:roster'

/** Placement after the deployment's own contexts (110 / 115 / 120). */
export const ROSTER_CONTEXT_ORDER = 130

/**
 * Whether one live agent is the Team Lead.
 *
 * `tryMembership` is the deployment's own non-throwing resolver
 * (`…\dsh-experimental-agent-team\lib\types\index.d.ts:100-105`): it answers
 * `undefined` for a plain subagent or a stale identity, which is precisely the
 * "not a team member, leave it alone" case.
 *
 * @param {any} teams - the `agentTeams` service.
 * @param {any} agent - candidate live agent.
 * @returns {boolean}
 */
export function isLead(teams, agent) {
  return membershipRole(teams, agent) === 'lead'
}

/**
 * Whether one live agent is a teammate (§5.64).
 *
 * @param {any} teams - the `agentTeams` service.
 * @param {any} agent - candidate live agent.
 * @returns {boolean}
 */
export function isTeammate(teams, agent) {
  return membershipRole(teams, agent) === 'teammate'
}

/**
 * The membership role of one live agent, or `undefined` when it is not a member.
 *
 * @param {any} teams - the `agentTeams` service.
 * @param {any} agent - candidate live agent.
 * @returns {string | undefined}
 */
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

/**
 * §5.65 — 成员收到的回报骨架（用户 m01746 批准：把 §5.64 那一句换成这份形状）。
 *
 * ⚠️ 只改这里；不要再加细则，也不要写进任何角色的 `AGENTS.md`。
 */
export const TEAMMATE_STYLE_LINE = TEAMMATE_REPLY_LINES.join('\n')

/** Stable name of the teammate style contribution. */
export const STYLE_CONTEXT_NAME = 'agent-team-roles:chat-style'

/**
 * Register the one-line chat style contribution on one **teammate's** scope.
 *
 * @param {any} agent - the exact live teammate agent.
 * @returns {(() => void) | null} the `systemPrompt.context()` disposer, or null.
 */
export function installTeammateStyle(agent) {
  const scoped = agent === null || agent === undefined ? undefined : agent.ctx
  const prompt = scoped === null || scoped === undefined ? undefined : scoped.systemPrompt
  if (prompt === null || prompt === undefined || typeof prompt.context !== 'function') return null
  return prompt.context({ name: STYLE_CONTEXT_NAME, order: ROSTER_CONTEXT_ORDER, text: TEAMMATE_STYLE_LINE })
}

/**
 * Register the roster on one agent's scope.
 *
 * The provider must never throw: a throwing `text` provider fails prompt
 * assembly, which would break the Lead's turn — so the roster read is guarded
 * and an unreadable roster contributes nothing.
 *
 * @param {any} agent - the exact live Lead agent.
 * @param {any} teams - the `agentTeams` service.
 * @param {(error: unknown) => void} [onError] - reports a failed roster read.
 * @param {{ roles?: object[] | (() => object[]), prefix?: string }} [options]
 *   the stored roles (or a getter, so a role edited mid-session shows up) and
 *   the preset id prefix; without them only the member half is contributed.
 * @returns {(() => void) | null} the `systemPrompt.context()` disposer, or null.
 */
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

