/**
 * Per-role skill selection (§5.47).
 *
 * A role either **inherits** the skills its mode's `skill-filesystem` row finds
 * in the deployment's usual roots — the default, and what every role did before
 * this section — or **picks** an explicit list of them.
 *
 * The pick is expressed with the two knobs the row already has, so nothing new
 * is invented (R3):
 *
 *     includeDefaultRoots: false
 *     customSkillDirs: ['<skill dir>', …]
 *
 * The second one is *append* semantics in `dsh-skill-filesystem`
 * (`lib/index.js:150-188`: project roots 100/200, custom 300, user 400/500), and
 * `discoverRoot` accepts a root whose entry **is** the skill directory — it reads
 * `<entry>/SKILL.md` (`:56-89`). Pointing the row at the picked skills' own
 * directories therefore selects exactly those skills, with no copy, no link and
 * no file of ours on disk. Turning the default roots off is what makes it an
 * exclusive list rather than an addition: "勾选就是选用，不勾选就是不加载".
 *
 * ⚠️ The global layer is **not** filterable: `collectFresh` merges
 * `[global, ...scope chain]` and the nearest layer wins per name, with no deny
 * list (`dsh-skill/lib/index.js:298-311`, `:95-107`). A skill that some
 * deployment-wide provider registers stays visible to every role; a name this
 * selection also registers is shadowed by the nearer layer. `standalone`
 * expectations are checked against the live panel, not assumed.
 *
 * ⚠️ 极简模式 (`minimal`) ships neither `skill-filesystem` nor `tool-skill`, so a
 * picking role there gains both rows: the first discovers, the second is the
 * consumer the model actually sees (`<available_skills>` + the `skill` tool).
 * Missing either one silently disables the feature.
 *
 * 扫描（找有哪些技能）在 `skillScan.js` 里（长脚本拆分），这里只用它。
 *
 * @module dsh-agent-team-roles/skills
 */
import { parseSkillHeader, scanSkills, skillRoots } from './skillScan.js'

/** The row that discovers local skills. */
export const SKILL_ROW_ID = 'skill-filesystem'
/** The row that exposes them to the model. Without it discovery is invisible. */
export const SKILL_TOOL_ROW_ID = 'tool-skill'
/** Package names the two rows mount. */
export const SKILL_PLUGIN_NAME = '@deepseek-ai/dsh-skill-filesystem'
export const SKILL_TOOL_PLUGIN_NAME = '@deepseek-ai/dsh-tool-skill'
/** The file a skill directory must carry. */
export const SKILL_FILE = 'SKILL.md'
/** The two modes a stored role can be in. */
export const SKILL_MODES = ['inherit', 'pick']

/** @returns {{ mode: 'inherit' | 'pick', ids: string[] }} */
export function defaultSkills() {
  return { mode: 'inherit', ids: [] }
}

/**
 * Validate the skill block arriving from disk or from the UI.
 *
 * Both load and write run this, so unknown keys are dropped rather than
 * preserved (they would otherwise round-trip forever). The ids are kept even in
 * `inherit` mode: switching a role to `inherit` and back must not lose the
 * selection the user made.
 *
 * @param {unknown} input
 * @returns {{ mode: 'inherit' | 'pick', ids: string[] }}
 */
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

/**
 * Turn each role's picked names into the directories the row must point at.
 *
 * A name that is no longer on disk is dropped and reported: the role keeps the
 * intent (`role.skills.ids`), the composition only ever mounts what exists, so
 * uninstalling a skill degrades to "not mounted" instead of a broken preset.
 *
 * @param {object[]} roles
 * @param {{ skills?: object[] }} scan - the result of `scanSkills`.
 * @returns {Map<string, { dirs: string[], missing: string[] }>}
 */
export function resolveRoleSkillDirs(roles, scan) {
  const byName = new Map()
  for (const skill of scan?.skills ?? []) if (!byName.has(skill.name)) byName.set(skill.name, skill)

  /** @type {Map<string, { dirs: string[], missing: string[] }>} */
  const out = new Map()
  for (const role of roles ?? []) {
    const skills = normalizeSkills(role?.skills)
    if (skills.mode !== 'pick') continue
    /** @type {string[]} */
    const dirs = []
    /** @type {string[]} */
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

/**
 * Point a role's `skill-filesystem` row at its picked skills (§5.47).
 *
 * An override of an **existing** row's config, like `withInstructionHome`: the
 * two keys the row already documents, nothing invented. A `customSkillDirs` or
 * `includeDefaultRoots` the user set by hand wins — the same escape hatch the
 * instruction row offers, so a hand-written role is never silently rewritten.
 *
 * `inherit` (the default) leaves the overrides untouched: a role that never
 * opened this section composes exactly the mode's snapshot.
 *
 * @param {Record<string, { disabled?: boolean, config?: object }>} overrides
 * @param {unknown} input - the role's stored skill block.
 * @param {string[]} dirs - the resolved skill directories.
 * @returns {Record<string, { disabled?: boolean, config?: object }>}
 */
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

/**
 * The rows a picking role needs when its mode does not ship them.
 *
 * Only 极简模式 is in that situation today (it carries `persona` and a terminal
 * group). The two rows are added **as a pair**: discovery without the consumer
 * would look like it worked and change nothing.
 *
 * @param {unknown} input - the role's stored skill block.
 * @param {string[]} dirs
 * @param {object[]} plugins - the mode's rows, to see which already exist.
 * @returns {object[]}
 */
export function skillRowsFor(input, dirs, plugins) {
  const skills = normalizeSkills(input)
  if (skills.mode !== 'pick') return []

  const rows = Array.isArray(plugins) ? plugins : []
  /** @type {object[]} */
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
