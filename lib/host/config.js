/**
 * dsh-agent-team-roles — host half / 配置与身份（§5.46、§5.53、§5.58 A1）。
 *
 * 这里全是**不依赖运行期状态**的纯函数：插件配置的归一化、来自 UI 的模式/id 校验、
 * 网关配置的解析、以及把「一个成员」认回「一个角色」的几种读法。
 *
 * 拆出来的理由：这些函数被读路径、写路径、成员绑定窗口三处共用，而它们没有闭包
 * 依赖，单独成文件后其余模块可以只 import 不复制。
 *
 * @module dsh-agent-team-roles/host/config
 */
import { defaultDir } from '../store.js'
import { DEFAULT_MODE, MODES } from '../template.js'
import { dshHome } from '../deployment.js'

/** Server names the MCP bridge accepts; matching it keeps a typo loud. */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * @param {object} config - the plugin's own config row.
 * @returns {{ dir: string, prefix: string, bindMembers: boolean, home: string }}
 */
export function normalizeConfig(config) {
  const raw = config && typeof config === 'object' ? config : {}
  const dir = typeof raw.dir === 'string' && raw.dir.trim().length > 0 ? raw.dir.trim() : defaultDir()
  const prefix =
    typeof raw.prefix === 'string' && raw.prefix.length > 0 ? raw.prefix : 'team-'

  /**
   * Where the *deployment's* files live (the connector's storage, the profile
   * patches). Normally `$DSH_HOME`, and overridable so a test can point the
   * plugin at a fixture instead of the machine it happens to run on.
   */
  const home = typeof raw.home === 'string' && raw.home.trim().length > 0 ? raw.home.trim() : dshHome()

  return { dir, prefix, bindMembers: raw.bindMembers === true, home }
}

/**
 * Validate a mode that arrived from the UI.
 *
 * `normalizeRole` deliberately *coerces* an unknown mode to `standard` so a role
 * file written by another build still loads. A posted mode is a different
 * situation: it is a direct instruction, and quietly switching a role to
 * `standard` because of a typo would look like the click worked. So the raw
 * value is checked here first — against the *live* roster (§5.40, m09580), not
 * against the four ids this plugin happens to know labels for.
 *
 * @param {unknown} value - the posted mode; omitted means `standard`.
 * @param {string[]} [known] - the mode ids this deployment has; defaults to the four dsh ships.
 * @returns {string}
 * @throws {Error} when the value is a mode this deployment does not have.
 */
export function requireMode(value, known) {
  const ids = Array.isArray(known) && known.length > 0 ? known : MODES.map((mode) => mode.id)
  if (value === undefined || value === null || String(value).trim().length === 0) return DEFAULT_MODE
  const id = String(value).trim()
  if (!ids.includes(id)) {
    throw new Error(`未知的模式：${id}（可选 ${ids.join(' / ')}）`)
  }
  return id
}

/**
 * Read an id that will become a directory name, refusing non-strings outright.
 *
 * `String(value)` looks harmless and is exactly how the `{"id": 123}` ⇄
 * `{"id": true}` holes got in: both coerce to something `ID_PATTERN` accepts, so
 * the panel built a real `123/` directory out of a JSON number and reported
 * success (§5.58 A1 follow-up, measured by the independent review). An id is a
 * name, so a number or a boolean here is a caller bug, not a shorthand.
 *
 * @param {unknown} value - the posted id; `undefined` means "not given".
 * @param {string} field - the JSON field name, for the message.
 * @returns {string|undefined}
 * @throws {Error} when the value is present and not a string.
 */
export function requireStringId(value, field) {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error(`${field} 必须是字符串，收到：${JSON.stringify(value ?? null)}`)
  }
  return value
}

/**
 * The gateway config a role preset mounts this plugin with, or `null`.
 *
 * A gateway mount is a *second* instance of this plugin living inside one agent's
 * preset composition. It must do exactly one thing — hide tools — and must not
 * touch the role store: two instances sharing `roles.json` would re-register
 * every preset from inside an agent scope.
 *
 * Two independent keys, because a role can deny MCP servers, plugin tools, both
 * or neither — and because the two are resolved differently: MCP by server
 * *prefix*, the plugin tools (§5.55) by exact name. Each key is `null` when the
 * role does not use that dimension at all, which keeps "the role asked for
 * this and it currently hides nothing" distinguishable from "the role never
 * asked".
 *
 * @param {object} config
 * @returns {{ mcp: string[] | null, toolGate: string[] | null } | null}
 */
export function gateConfig(config) {
  const raw = config && typeof config === 'object' ? config : {}

  /**
   * @param {unknown} source - one gateway block (`mcpGate` / `toolGate`).
   * @returns {string[] | null} its deny list, or `null` when the block is absent.
   */
  const denyList = (source) => {
    if (source === null || typeof source !== 'object' || Array.isArray(source)) return null
    /** @type {string[]} */
    const out = []
    const deny = /** @type {{ deny?: unknown }} */ (source).deny
    if (Array.isArray(deny)) {
      for (const value of deny) {
        const name = String(value ?? '').trim()
        if (name.length > 0 && !out.includes(name)) out.push(name)
      }
    }
    return out
  }

  const mcp = denyList(raw.mcpGate)
  const toolGate = denyList(raw.toolGate)
  if (mcp === null && toolGate === null) return null
  return { mcp, toolGate }
}

/**
 * Decide whether member binding is on right now.
 *
 * Two sources, OR-ed on purpose: the plugin config is a deployment decision
 * that needs a dsh restart, while the document setting can be flipped from the
 * UI at any time — which is exactly why it lives next to the roles instead of
 * in the config row.
 *
 * @param {{ bindMembers: boolean }} options - the normalized plugin config.
 * @param {{ bindMembers: boolean }} settings - the document-level switches.
 * @returns {boolean}
 */
export function bindingEnabled(options, settings) {
  return options.bindMembers === true || settings.bindMembers === true
}

/**
 * Read the delegation label a subagent child was created with.
 *
 * `dsh-subagent` appends its versioned `subagent/descriptor` event inside the
 * child's own creation window — before `ctx.agents.create()` resolves — so the
 * label is already on the child's log by the time `agent/created` fires. That
 * ordering is what makes a role bindable to a member at all: the other source,
 * the parent's `subagent/catalog`, is appended once the child already exists.
 *
 * The **first** descriptor in the child's own log is the authoritative one:
 * `foldSubagentDescriptor` in `dsh-subagent` documents that "the establishing
 * provider appends exactly one, so a later same-type event cannot rewrite the
 * declared composition". Scanning forwards keeps our classification identical
 * to the one dsh itself derives. (Every one of the 42 real child logs on this
 * machine carries exactly one descriptor, so the order only matters if that
 * ever changes.)
 *
 * @param {object} session - the child agent's session.
 * @returns {string | undefined} the trimmed label, or undefined when absent.
 */
export function delegationLabel(session) {
  if (session === null || typeof session !== 'object') return undefined
  if (typeof session.ownEvents !== 'function') return undefined
  const events = session.ownEvents()
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event === null || typeof event !== 'object' || event.type !== 'subagent/descriptor') continue
    const label = event.data === undefined ? undefined : event.data.label
    return typeof label === 'string' && label.trim().length > 0 ? label.trim() : undefined
  }
  return undefined
}

/**
 * Find the role a delegation label names.
 *
 * The mapping needs no second data model: a member called `reviewer` runs under
 * the role called `reviewer`, which is exactly what「每个成员对应一个独立的角色」
 * means in practice. The preset id without its prefix is accepted as an alias, so
 * a member named `team-reviewer` resolves too.
 *
 * @param {object[]} roles
 * @param {string} label
 * @param {string} prefix
 * @returns {object | undefined}
 */
export function roleForLabel(roles, label, prefix) {
  const wanted = String(label ?? '').trim().toLowerCase()
  if (wanted.length === 0) return undefined
  return roles.find((role) => {
    if (role === null || typeof role !== 'object' || role.invalid === true) return false
    if (String(role.name ?? '').trim().toLowerCase() === wanted) return true
    const id = String(role.id ?? '')
    return id.startsWith(prefix) && id.slice(prefix.length).toLowerCase() === wanted
  })
}

/**
 * The Team name the runtime recorded for one agent, when it is a member.
 *
 * §5.46 — this is the **deterministic** half of role binding. The name is
 * validated by the runtime before the child exists (lowercase kebab, unique in
 * the team, never `lead`: `…\dsh-experimental-agent-team\lib\index.js:342`,
 * `:703-705`), the `team/member` event is appended and flushed before the child
 * session starts (`:561-570`), and `agentTeams.tryMembership` answers even while
 * the membership is still `provisioning` (`:397-410`) — so at `agent/created`
 * the name is already there to read.
 *
 * `ctx.get` is used instead of a second `inject` on purpose: this module already
 * has the `agentPresets` scope, and a profile without the Agent Teams runtime
 * must still load the roles panel (the whole block would stay pending if
 * `agentTeams` were required). The read is inside `try`/`catch` because a
 * missing service may either answer `undefined` or throw.
 *
 * @param {any} ctx - the injecting scope.
 * @param {any} agent - the freshly created agent.
 * @returns {string | undefined} the member name, or undefined for a plain subagent.
 */
export function memberNameOf(ctx, agent) {
  try {
    if (ctx === null || ctx === undefined || typeof ctx.get !== 'function') return undefined
    const teams = ctx.get('agentTeams')
    if (teams === undefined || teams === null || typeof teams.tryMembership !== 'function') return undefined
    const membership = teams.tryMembership(agent)
    if (membership === null || typeof membership !== 'object') return undefined
    const name = membership.name
    return typeof name === 'string' && name.trim().length > 0 ? name.trim() : undefined
  } catch {
    return undefined
  }
}

/**
 * The Team name the runtime recorded for a child that is **still being created**.
 *
 * §5.53 — the creation window runs before the child is registered, and
 * `tryMembership` refuses an unregistered Agent
 * (`…\dsh-experimental-agent-team\lib\types\roster.js:65`:
 * `if (this.ctx.agents.get(agent.id) !== agent) return undefined`). The Lead's
 * durable roster is readable one step earlier: `spawnAdmitted` journals
 * `team/member` (phase `provisioning`) *before* it asks for the child, and
 * `listMembers(lead)` folds that journal (`…\lib\types\roster.js:104-119`) — so the
 * member name is the deterministic key here too, with the descriptor label as the
 * fallback for a plain subagent.
 *
 * The Lead is alive and registered (`params.parentAgent`), so it is a valid
 * credential for the runtime's own reader. `ctx.get` is used instead of a second
 * `inject` for the same reason as `memberNameOf`: a profile without the Agent
 * Teams runtime must still load.
 *
 * @param {any} ctx - the injecting scope.
 * @param {any} lead - the child's `parentAgent`.
 * @param {string} childId - the child's Session id, which is its member id.
 * @returns {string | undefined} the member name, or undefined for a plain subagent.
 */
export function pendingMemberName(ctx, lead, childId) {
  try {
    if (ctx === null || ctx === undefined || typeof ctx.get !== 'function') return undefined
    const teams = ctx.get('agentTeams')
    if (teams === undefined || teams === null || typeof teams.listMembers !== 'function') return undefined
    const rows = teams.listMembers(lead)
    if (!Array.isArray(rows)) return undefined
    const row = rows.find(
      (candidate) =>
        candidate !== null && typeof candidate === 'object' && String(candidate.id) === String(childId),
    )
    const name = row === undefined ? undefined : row.name
    return typeof name === 'string' && name.trim().length > 0 ? name.trim() : undefined
  } catch {
    return undefined
  }
}
