/**
 * dsh-agent-team-roles — host half / 读路径：模式与快照（§5.32、§5.40、§5.54）。
 *
 * 角色是按「部署模式」拼出来的，而模式清单**不是写死的四个**：它就是部署里
 * `agentPresets` 的名册（m09580）。这个文件负责把「一个模式」解析成一份组合
 * （**始终**读加载器里的实时声明，插件不存副本），并维护那份名册的短缓存。
 *
 * 缓存策略是 §5.54 的关键：`modeRoster` 只在**显式重载**时失效，角色的挂/卸不会
 * 让它失效（`readRoster` 按角色 id 排除），所以写路径不必等 Host Loader。
 *
 * @module dsh-agent-team-roles/host/modes
 */
import { DEFAULT_MODE, MODES, isModeId, normalizeMode, shippedLabel } from '../template.js'
import { presetDeclarations, templateFromDeclaration } from '../live-template.js'
import { loadDeployment } from '../deployment.js'

/**
 * @param {object} h - the shared host state ({@link ./context.js}).
 * @returns {object} the mode/snapshot read API.
 */
export function createModes(h) {
  /**
   * Every preset declaration the Loader currently holds, keyed by preset id
   * (§5.40). Re-read on every call: the user may create or delete a preset at
   * any time, and reading costs no IO — the Loader already parsed the patch.
   */
  const liveDeclarations = () => presetDeclarations(h.ctx.loader)

  /**
   * A mode's composition, read straight out of the preset declaration the
   * deployment loaded (§5.40). Nothing is cached and nothing is copied: the user
   * may edit a preset at any time, and the next composition has to see that.
   *
   * @param {string} id
   * @returns {object | null}
   */
  const resolveSnapshot = (id) => {
    const declaration = liveDeclarations().get(id)
    return declaration === undefined ? null : templateFromDeclaration(declaration)
  }

  /**
   * The deployment's agent presets — the *roster*, and with it the mode list
   * (§5.40).
   *
   * m09580: 「改成多选框，从现有的模式中加载 … 不要写死」. What the user edits in
   * the preset editor is what `agentPresets.list()` reports, so that is what the
   * mode picker offers. Two things are filtered out: our own role presets (they
   * are in the same registry — a role is not a mode), and ids that are not
   * usable as a file-name component.
   *
   * `name` is null for the four shipped presets: a preset declaration carries an
   * id and an order, no label. The labels this plugin knows fill that gap in
   * `describeModes`; a preset the user created carries its own name.
   *
   * @returns {Promise<{ id: string, name: string | null, description: string | null, broken: boolean }[]>}
   */
  const readRoster = async (options_ = undefined) => {
    const force = options_ !== undefined && options_.refresh === true
    if (!force && h.modeRoster !== null) return h.modeRoster
    if (h.presets === null || typeof h.presets.list !== 'function') return []
    let records
    try {
      records = await h.presets.list()
    } catch (error) {
      h.logger.warn(`读不到预设名册，模式清单回落到自带的四个：${String((error && error.message) || error)}`)
      return []
    }
    const list = Array.isArray(records) ? records : Array.isArray(records?.presets) ? records.presets : []
    // §5.54 — 角色不再按「有没有挂载」排除，而是按**它是不是我们的角色**排除：改完
    // 配置还没挂载的角色依然不是模式，而注册表里那个陈旧代际也不该冒充一个模式。
    // `store.roles` 与 `registered` 取并集，这样挂/卸角色都不会让这份缓存失效 —— 它正是
    // 写路径不再等 Host Loader 的关键。
    const own = new Set([...h.store.roles.map((role) => role.id), ...h.registered.keys()])
    const out = []
    const seen = new Set()
    for (const record of list) {
      if (record === null || typeof record !== 'object') continue
      const id = typeof record.id === 'string' ? record.id.trim() : ''
      if (id === '' || seen.has(id) || own.has(id)) continue
      if (!isModeId(id)) continue
      seen.add(id)
      out.push({
        id,
        name: typeof record.name === 'string' && record.name !== '' ? record.name : null,
        description: typeof record.description === 'string' && record.description !== '' ? record.description : null,
        broken: record.broken === true,
      })
    }
    h.modeRoster = out
    return out
  }

  /**
   * The mode ids a posted mode may name: everything the roster offers, or the
   * bundled four when there is no roster to read.
   *
   * @returns {Promise<string[]>}
   */
  const knownModeIds = async () => {
    const roster = await readRoster()
    return roster.length > 0 ? roster.map((entry) => entry.id) : MODES.map((mode) => mode.id)
  }

  /**
   * The composition one mode composes roles from (§5.40).
   *
   * Rebuilt from the Loader's declaration on every call: a preset the user is
   * still editing has to be allowed to change, it costs no IO, and the plugin
   * keeps no copy that could drift from the deployment.
   *
   * @param {string} [mode]
   * @returns {Promise<object>}
   */
  const ensureTemplate = async (mode = DEFAULT_MODE) => {
    const id = normalizeMode(mode)
    const template = resolveSnapshot(id)
    if (template === null) {
      throw new Error(`这个部署里没有 ${id} 这个模式：加载器里没有它的预设声明`)
    }
    return template
  }

  /**
   * The mode roster the UI draws its picker from (§5.40).
   *
   * The list *is* the deployment's preset list, so deleting or creating a preset
   * changes the candidates — that is the whole point of m09580. Labels are the
   * preset's own name when it has one, else the label this plugin knows for the
   * four presets dsh ships, else the id. A mode whose declaration is gone is
   * still listed but marked `available: false`, so the UI can offer it disabled
   * instead of letting a click fail.
   *
   * @returns {Promise<{ id: string, label: string, description: string | null, available: boolean, source: 'live'|'missing', file: null, rowCount: number }[]>}
   */
  const describeModes = async () => {
    const roster = await readRoster()
    const entries = roster.length > 0 ? roster : MODES.map((mode) => ({ id: mode.id, name: null, description: null, broken: false }))
    const live = liveDeclarations()
    const out = []
    for (const entry of entries) {
      const id = entry.id
      const label = entry.name ?? shippedLabel(id) ?? id
      const common = { id, label, description: entry.description ?? null }
      const declaration = live.get(id)
      if (declaration === undefined) {
        out.push({ ...common, available: false, source: 'missing', file: null, rowCount: 0 })
        continue
      }
      out.push({
        ...common,
        available: true,
        source: 'live',
        file: null,
        rowCount: declaration.plugins.length,
      })
    }
    return out
  }

  /** @returns {Promise<{ source: object, loop: object | null }>} */
  const ensureDeployment = async () => {
    if (h.deployment === null) h.deployment = await loadDeployment()
    return h.deployment
  }

  /** §5.54 — 让下一次读模式清单重新问一遍部署（显式「重载」用）。 */
  const invalidateRoster = () => {
    h.modeRoster = null
  }

  return { liveDeclarations, resolveSnapshot, readRoster, knownModeIds, ensureTemplate, describeModes, ensureDeployment, invalidateRoster }
}
