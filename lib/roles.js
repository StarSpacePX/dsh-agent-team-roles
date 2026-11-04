/**
 * Turning a stored role into an agent-preset definition.
 *
 * A role carries only *intent*; the composition it mounts is recomposed here
 * from the live declaration **of the mode the role names** (§5.40) every time.
 * That split is what lets a role survive a dsh upgrade: the template's rows
 * follow the deployment, while the role's own decisions stay fixed.
 *
 * @module dsh-agent-team-roles/roles
 */
import { INSTRUCTION_ROW_ID, buildMcpGateRow, buildToolGateRow, defaultCapabilities, normalizeCapabilities } from './deployment.js'
import { defaultSkills, skillRowsFor, withSkillDirs } from './skills.js'
import { DEFAULT_MODE, composeRows, modeLabel, normalizeMode } from './template.js'

/** Order values are relative to each other, not to the shipped presets' 1..4. */
const DEFAULT_ORDER = 10

/**
 * The rows a role gains **on top of** its mode's snapshot.
 *
 * This is the directed exception to R3 the user authorized on 2026-09-27: the
 * MCP dimension has no row in the shipped presets to switch, so the role
 * declares it itself. §5.55 (user m18131) declares the second one for the same
 * reason — the plugin tools a role should not see have no row either. Every
 * other dimension — including the role's own instruction file — only ever edits
 * an existing row's `disabled` / `config`.
 *
 * The builders return `null` when the role asks for nothing, which is the
 * default: a role that never opened the panel composes exactly the snapshot — no
 * extra row, no changed behaviour.
 *
 * @param {object} role
 * @returns {object[]}
 */
function capabilityRows(role) {
  const capabilities = normalizeCapabilities(role.capabilities)

  /** @type {object[]} */
  const rows = []

  const gate = buildMcpGateRow(capabilities.mcp.deny)
  if (gate !== null) rows.push(gate)

  const toolGate = buildToolGateRow(capabilities.toolGate.deny)
  if (toolGate !== null) rows.push(toolGate)

  return rows
}

/**
 * Point a role's own instruction file at the role (§5.30).
 *
 * `dsh-agent-instructions` always adds `join(config.dshHome, 'AGENTS.md')` to
 * its candidates before it walks up from the session's cwd
 * (`dsh-agent-instructions/lib/index.js:552`, `USER_GLOBAL_FILE` at `:141`), so
 * giving the row a `dshHome` of the role's directory makes `<roleDir>/AGENTS.md`
 * load for that role **whatever directory the task runs in** — and the project's
 * own `AGENTS.md` still loads behind it. Verified against the real package:
 * `discoverBaselineInstructionFiles({ cwd, dshHome, maxBytes })` returns
 * `<roleDir>/AGENTS.md` (as `$DSH_HOME/AGENTS.md`) plus the project file.
 *
 * This is an override of an **existing** row, not a new row, which is why it
 * stays inside R3. A stored `dshHome` that **points somewhere else** wins, so
 * pointing a role at another home stays possible. A `null`/empty one
 * (applyConfig's "delete this key") does **not** win — see §5.58 D4 below.
 *
 * ⚠️ One mode has no row to point at: `minimal` ships `persona` and a terminal
 * group and nothing else, so this override is inert there and the role's own
 * `AGENTS.md` is not read. That is reported to the UI (`agentsMd.hasRow` in
 * `buildState`) instead of being papered over with a row the deployment does not
 * have — R3 forbids inventing one.
 *
 * @param {Record<string, { disabled?: boolean, config?: object }>} overrides
 * @param {string} [home] - the role's directory; empty means "leave it alone".
 * @returns {Record<string, { disabled?: boolean, config?: object }>}
 */
export function withInstructionHome(overrides, home) {
  const target = typeof home === 'string' ? home.trim() : ''
  if (target.length === 0) return overrides

  const existing = overrides[INSTRUCTION_ROW_ID]
  const pinned = existing?.config?.dshHome
  // §5.58 D4 — 只有**指向别处**的 dshHome 才算用户的主张，才让位。`null` / 空串是
  // applyConfig 的「删掉这个键」，不是「别再写这个键」；把它当成「没有主张」才走我们的
  // override。放它赢的代价是同一份 AGENTS.md 注入两遍：角色目录就在 `~/.dsh` 里面，
  // 「同目录候选」与「user-global 候选」指向同一位置，而上游跨目录不去重
  // （`…\dsh-agent-instructions\lib\index.js:632` 明写 "Different directories never
  // collapse even when identical."），实测未编辑副本 4,734 字符 ×2 = 9,468 字符。
  if (typeof pinned === 'string' && pinned.trim().length > 0) return overrides

  return {
    ...overrides,
    [INSTRUCTION_ROW_ID]: { ...existing, config: { ...existing?.config, dshHome: target } },
  }
}

/**
 * Pick the snapshot a role composes from.
 *
 * Two shapes are accepted on purpose. A **function** is the real thing: the
 * caller owns the cache and answers per mode (§5.32, `index.js` resolves each
 * role's `mode`). A plain **object** is one snapshot for every role — what a
 * test wants when it is exercising composition rather than the mode switch.
 *
 * @param {object | ((mode: string) => object)} templateOf
 * @param {string} mode
 * @returns {object}
 */
function resolveTemplate(templateOf, mode) {
  return typeof templateOf === 'function' ? templateOf(mode) : templateOf
}

/**
 * Compose the preset definition for one role.
 *
 * @param {object} role - a normalized role from the store.
 * @param {object | ((mode: string) => object)} templateOf - the mode's snapshot,
 *   or a resolver for it.
 * @param {string} [platform]
 * @param {{ dirOf?: (id: string) => string, skillDirOf?: (id: string) => string[] }} [options] - where the roles live and which skill directories they picked (§5.47).
 * @returns {{ id: string, name: string, description: string, order: number, plugins: object[] }}
 */
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
      // §5.47 — 极简模式 has no skill rows at all, so a picking role gains the
      // pair. For every other mode this is empty: the override above already
      // rewrote a row that exists, which is the R3-friendly path.
      ...skillRowsFor(role.skills, skillDirs, snapshot.plugins),
    ],
  }
}

/**
 * Build the definition for every stored role.
 *
 * Invalid roles (a malformed entry salvaged from disk) are skipped here rather
 * than aborting the whole registration pass.
 *
 * @param {object[]} roles
 * @param {object | ((mode: string) => object)} templateOf
 * @param {string} [platform]
 * @param {{ dirOf?: (id: string) => string, skillDirOf?: (id: string) => string[] }} [options]
 * @returns {{ definitions: object[], skipped: { id: string, reason: string }[] }}
 */
export function buildDefinitions(roles, templateOf, platform = process.platform, options = {}) {
  /** @type {object[]} */
  const definitions = []
  /** @type {{ id: string, reason: string }[]} */
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

/**
 * A brand-new role, pre-filled from a mode's snapshot so the UI can show the
 * whole capability table immediately.
 *
 * @param {string} id - the preset id, already prefixed.
 * @param {string} name
 * @param {object} template - the snapshot of the mode the role starts on.
 * @param {string} [mode] - defaults to the snapshot's own preset id, so a caller
 *   that passed one snapshot gets a role that agrees with it.
 * @returns {object} a role ready for `RoleStore.upsert`.
 */
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
    // §5.47 — a new role inherits the mode's skills until the user picks some.
    skills: defaultSkills(),
  }
}

/**
 * Derive a valid preset id from a free-form role name.
 *
 * ASCII names slugify; a name with no ASCII at all falls back to a stable hash
 * so two Chinese-named roles never collide on the empty string.
 *
 * @param {string} name
 * @param {string} prefix
 * @returns {string}
 */
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

/**
 * The one name a teammate must be created with to take this role (R1, §5.46).
 *
 * The preset id already encodes it: `slugify(role.name, prefix)` produced
 * `${prefix}${slug}`, so dropping the prefix yields the member name. Using the
 * **id** rather than re-slugifying the name is what makes this stable for
 * Chinese role names too — those have no ASCII and slugify falls back to a
 * deterministic hash (`slugify`, above), which is exactly as unique and exactly
 * as reproducible as the id itself.
 *
 * @param {{ id?: unknown }} role
 * @param {string} prefix
 * @returns {string}
 */
export function memberNameForRole(role, prefix) {
  const id = String((role === null || role === undefined ? '' : role.id) ?? '')
  const tag = String(prefix ?? '')
  return tag.length > 0 && id.startsWith(tag) ? id.slice(tag.length) : id
}

/**
 * Resolve a role from the name the Team runtime itself recorded (R1, §5.46).
 *
 * The runtime's name is the deterministic fact: `spawn_teammate` validates it
 * (lowercase kebab, unique in the team — `dsh-experimental-agent-team`
 * `MEMBER_NAME`), and `agentTeams.tryMembership(agent).name` answers it
 * *before* the child's first turn. By contrast the descriptor `label` is
 * `description`, free-form natural language, which is why name matching missed.
 *
 * Accepts both the bare member name and the full preset id, case-insensitively;
 * a role's human name is deliberately **not** consulted (Chinese names never
 * appear as member names — that is what `memberNameForRole` exists for).
 *
 * @param {object[]} roles
 * @param {string} name
 * @param {string} prefix
 * @returns {object | undefined}
 */
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
