/**
 * Live preset declarations, read straight out of the Loader (§5.40).
 *
 * A role is composed from a *mode* — the plugin list of one agent preset in
 * this deployment. That list belongs to the deployment, not to us: m09580
 * 「改成多选框，从现有的模式中加载 … 不要写死」. Every mode — the four dsh ships
 * and any preset the user made — is read from exactly where dsh read it: the
 * Loader entry of `@deepseek-ai/dsh-agent-preset`, whose `options.config` is the
 * parsed declaration `{ id, name?, description?, order?, plugins }`. The plugin
 * keeps no copy, so editing a preset shows up on the next composition and a dsh
 * upgrade is followed instead of frozen out.
 *
 * Parsed, not YAML: the Loader already consumed the patch file through
 * `entryListSchema` (`@deepseek-ai/cordis-plugin-include`), so a `!!js` scalar
 * arrives as `{ __jsExpr: <expr> }`. It is rewritten here to the marker the
 * composer reads (`{ __js__: <expr> }`) so that `resolveGate` in `template.js`
 * remains the only place that knows how a platform gate is evaluated.
 *
 * @module dsh-agent-team-roles/live-template
 */

const JS_MARKER = '__jsExpr'

/**
 * Rewrite a parsed Loader value into the shape our snapshot files use.
 *
 * Only `{ __jsExpr }` is special; everything else is copied structurally so the
 * caller can never mutate the Loader's own config.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
const toTemplateValue = (value) => {
  if (Array.isArray(value)) return value.map(toTemplateValue)
  if (value === null || typeof value !== 'object') return value
  if (typeof value[JS_MARKER] === 'string') return { __js__: value[JS_MARKER] }
  const out = {}
  for (const [key, item] of Object.entries(value)) out[key] = toTemplateValue(item)
  return out
}

/**
 * Every preset declaration the Loader currently holds, keyed by preset id.
 *
 * Declarations are recognised by shape rather than by module name — a
 * `@deepseek-ai/dsh-agent-preset` row carries a non-empty string `config.id`
 * and an array `config.plugins`. The caller intersects this map with the
 * registry roster, so shape recognition alone can never leak a row into the
 * mode list.
 *
 * @param {object | null | undefined} loader - `ctx.loader`; a test harness may
 *   not have one, in which case this is simply an empty map.
 * @returns {Map<string, { id: string, entryId: string | null, plugin: string | null, name: string | null, order: number | null, plugins: object[] }>}
 */
export const presetDeclarations = (loader) => {
  const out = new Map()
  const entries = typeof loader?.entries === 'function' ? loader.entries() : []
  for (const entry of entries) {
    const options = entry?.options
    if (options === null || typeof options !== 'object') continue
    const config = options.config
    if (config === null || typeof config !== 'object') continue
    if (typeof config.id !== 'string' || config.id.trim() === '') continue
    if (!Array.isArray(config.plugins)) continue
    const id = config.id.trim()
    if (out.has(id)) continue // first declaration wins — a duplicate id is the registry's call to make
    out.set(id, {
      id,
      entryId: typeof entry.id === 'string' ? entry.id : null,
      plugin: typeof options.name === 'string' ? options.name : null,
      name: typeof config.name === 'string' && config.name !== '' ? config.name : null,
      order: typeof config.order === 'number' && Number.isFinite(config.order) ? config.order : null,
      plugins: config.plugins,
    })
  }
  return out
}

/**
 * Wrap a live declaration as the mode template the rest of the plugin composes.
 *
 * `source.live` marks it as read from the running Loader instead of a file, and
 * `source.file` is always null — there is no file any more, so the UI never
 * prints a path that does not exist.
 *
 * @param {{ id: string, entryId: string | null, plugin: string | null, order: number | null, plugins: object[] }} declaration
 * @returns {{ $comment: string, source: object, plugins: object[] }}
 */
export const templateFromDeclaration = (declaration) => ({
  $comment: 'Read live from the Loader’s parsed preset declaration (§5.40).',
  source: {
    file: null,
    live: true,
    declarationId: declaration.entryId,
    plugin: declaration.plugin,
    presetId: declaration.id,
    order: declaration.order,
    extractedAt: null,
  },
  plugins: toTemplateValue(declaration.plugins),
})
