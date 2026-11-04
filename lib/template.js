/**
 * The agent presets dsh ships — their ids and labels — plus the operations that
 * turn a stored role into the composition rows dsh actually mounts.
 *
 * Three jobs live here:
 *
 *  1. **Mode labels.** The four preset ids dsh ships, with the labels the
 *     shipped picker shows. No composition is copied here: every mode is read
 *     live from the Loader (`lib/live-template.js`, §5.40), so a role always
 *     composes the deployment's *current* rows and a dsh upgrade is followed
 *     instead of frozen out.
 *  2. **Gate resolution.** `!!js` scalars cannot survive JSON, so a JSON fixture
 *     keeps them as `{ "__js__": <expr> }`. A preset row is part of a
 *     composition list, and `entryListProblem()` rejects anything that is not a
 *     plain row, so every gate has to become a concrete boolean before the
 *     definition is handed to `agentPresets.register()`.
 *  3. **Row description.** The configuration UI works on *rows*, not on YAML, so
 *     this module flattens the tree into an addressable list and classifies each
 *     row into one of the six dimensions the UI groups by.
 *
 * @module dsh-agent-team-roles/template
 */
/**
 * The four modes the deployment ships, in the order the new-task page lists
 * them (`preset-standard` order 1, `ptc` 2, `minimal` 3, `cordis` 4).
 *
 * The labels are the ones the shipped picker shows
 * (`@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js`: 「标准模式」 /
 * 「PTC 模式」 / 「极简模式」 / 「创造模式」); a preset declaration itself carries
 * no display name, only an id and an order.
 *
 * This is not the mode *roster* (§5.40): a role may be built from
 * any preset the deployment holds, and the roster comes from the live registry.
 * What stays here is the set of ids whose labels this plugin can supply — the
 * four the shipped picker names — plus the fallback list used when the roster
 * cannot be read. The compositions themselves are never stored: every mode,
 * shipped or user-made, is read live from the Loader (§5.40).
 */
export const MODES = [
  { id: 'standard', label: '标准模式' },
  { id: 'ptc', label: 'PTC 模式' },
  { id: 'minimal', label: '极简模式' },
  { id: 'cordis', label: '创造模式' },
]

/** The mode a role is based on unless it says otherwise (m07307: 「默认使用标准模式」). */
export const DEFAULT_MODE = 'standard'

/**
 * A mode id is a preset id, and it is used as a file name component
 * (`lib/template/<mode>.plugins.json`). Anything that could climb out of that
 * directory is refused before it reaches the filesystem.
 */
const MODE_ID_PATTERN = /^[A-Za-z0-9._-]+$/

/** @param {unknown} value @returns {boolean} whether `value` is a usable mode id. */
export function isModeId(value) {
  return typeof value === 'string' && value !== '' && MODE_ID_PATTERN.test(value)
}

/**
 * Coerce a stored or posted mode into an id.
 *
 * A non-empty id is kept as it is: since §5.40 the roster is the deployment's
 * (`agentPresets.list()`), so a mode this plugin has never heard of is a
 * legitimate live preset, not a typo. Only an empty or malformed value falls
 * back to `standard`. Callers that accept a mode from the UI validate the *raw*
 * value against the live roster first, so an unknown id is reported rather than
 * quietly reshaping a role.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeMode(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  if (id === '' || id === DEFAULT_MODE) return DEFAULT_MODE
  return isModeId(id) ? id : DEFAULT_MODE
}

/**
 * @param {string} id
 * @returns {string} the label the shipped picker uses for one of the four
 *   shipped modes, or `id` itself for any other preset — the registry's `name`
 *   is preferred by the caller when it has one, and an unknown id must not read
 *   as 「标准模式」.
 */
export function modeLabel(id) {
  const found = MODES.find((mode) => mode.id === normalizeMode(id))
  return found === undefined ? normalizeMode(id) : found.label
}

/**
 * The label of a mode dsh ships, if this plugin knows one.
 *
 * A preset declaration carries an id and an order, no display name, so the four
 * shipped presets get their label here; every other preset carries its own
 * `name` and the caller prefers that (§5.40).
 *
 * @param {string} id
 * @returns {string | null}
 */
export function shippedLabel(id) {
  const found = MODES.find((mode) => mode.id === id)
  return found === undefined ? null : found.label
}

/** `process.platform === '<literal>'` — the only comparison the deployment uses. */
const GATE_EQUALS = /^process\.platform\s*===\s*(['"])(.*?)\1$/
/** `process.platform !== '<literal>'` — its negation. */
const GATE_NOT_EQUALS = /^process\.platform\s*!==\s*(['"])(.*?)\1$/

/**
 * Turn one `!!js` scalar into a boolean.
 *
 * Only the two platform comparisons the shipped presets actually use are
 * understood. Anything else returns `undefined`, which the callers read as "no
 * gate": a row whose condition cannot be evaluated stays usable instead of
 * silently disappearing, and the expression itself is reported so an operator
 * can see what was skipped.
 *
 * @param {unknown} value - the raw scalar (or anything else).
 * @param {string} [platform] - platform to test against.
 * @returns {boolean | undefined} `undefined` when `value` is not a `!!js` scalar
 *   or its expression is not one of the supported comparisons.
 */
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

/**
 * Apply a stored config patch over a template config.
 *
 * A `null` in the patch deletes the key, which is the only way to express
 * "this template key should not be sent" without replacing the whole config.
 *
 * @param {object | undefined} base - the template's own config.
 * @param {object | undefined} patch - the role's stored patch.
 * @returns {object | undefined}
 */
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

/**
 * The boolean a template row's `disabled` field stands for, before overrides.
 *
 * @param {object} row
 * @param {string} platform
 * @returns {boolean}
 */
function templateDisabled(row, platform) {
  if (row.disabled === undefined) return false
  const resolved = resolveGate(row.disabled, platform)
  return resolved === undefined ? false : resolved === true
}

/** Rows whose dimension is not derivable from the id/name alone. */
const CATEGORY_BY_ID = new Map([
  // `persona` and `agent-instructions` are one dimension in the user's model:
  // "AGENTS.md 就是身份描述和一些规则" (m05741). `persona` carries the identity
  // line of the system prompt, `agent-instructions` carries the rule files, and
  // neither is a 「身份」 of its own.
  ['persona', 'agents-md'],
  ['agent-instructions', 'agents-md'],
  ['skill-filesystem', 'skill'],
  ['tool-skill', 'skill'],
]);

/**
 * Which of the six configurable dimensions a row belongs to.
 *
 * The user's dimensions are 工具 / 技能 / MCP / 分组 / loop / AGENTS.md. A `loop`
 * row is still *recognized* here, but since §5.30 it can never be part of a
 * role's composition — `agent-loop` owns the single agent-factory slot, so a
 * preset carrying one fails to mount. Rows that fit none of the dimensions (the
 * compaction group's children) fall into `other` rather than being forced into a
 * wrong bucket.
 *
 * @param {object} row
 * @param {boolean} isGroup
 * @returns {'group' | 'mcp' | 'agents-md' | 'loop' | 'skill' | 'tool' | 'other'}
 */
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

/**
 * The one row in the templates that can publish a **globally named** tool.
 *
 * `modelSelectionSettings: true` makes a single `@deepseek-ai/dsh-tool-subagent`
 * instance register `list_subagent_models` under a process-wide name —
 * `dsh-tool-subagent/README.zh.md`: 「每个工具作用域内最多一个实例可以拥有模型
 * 选择，因为 `list_subagent_models` 使用全局名称」.
 *
 * §5.53 — a teammate is rebound to the role preset **inside the creation window**,
 * before its parent's `preset-standard` standing listener could install a copy of this
 * row, so the role composition is the only owner of that global name and keeps the flag
 * exactly as the snapshot shipped it. Never rewrite it here: §5.52 defused it at
 * composition time and that silently took `list_subagent_models` plus the `subagent`
 * tool's `provider`/`model`/`reasoning_effort` arguments away from every role member.
 * A per-role override is the supported way to opt out.
 */

/**
 * Build the composition rows for one role.
 *
 * @param {object[]} rows - template rows.
 * @param {string} platform
 * @param {Record<string, { disabled?: boolean, config?: object }>} [overrides]
 * @returns {object[]}
 */
export function composeRows(rows, platform, overrides = {}) {
  return rows.map((row) => {
    const isGroup = row.group === true && Array.isArray(row.config)
    /** @type {Record<string, unknown>} */
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

    // §5.53 — the flag is deliberately *not* rewritten here any more; see the
    // `modelSelectionSettings` note above.

    return out
  })
}

/**
 * Flatten the template into the addressable row list the UI renders.
 *
 * A group child's `path` is `parent/child`; that is what the UI keys its own
 * nodes by. Overrides, though, are keyed by the **bare row id** — the very key
 * `composeRows` resolves — so the two halves cannot drift apart. That key is
 * only unambiguous while ids are unique, which the snapshot test asserts.
 *
 * `id` is `null` for a row the snapshot left nameless: it still renders, but it
 * cannot carry an override.
 *
 * There is no `depth` field: a group is exactly one level deep here, so it would
 * be a constant derived from `parent` that nothing reads.
 *
 * @param {object[]} rows
 * @param {string} platform
 * @param {Record<string, object>} [overrides]
 * @param {string | null} [parent]
 * @returns {object[]}
 */
export function describeRows(rows, platform, overrides = {}, parent = null) {
  /** @type {object[]} */
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
