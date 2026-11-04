/**
 * 读路径：模式与快照。
 *
 * 模式清单不是写死的四个，而是部署里 agentPresets 的名册；一个模式的组合始终从加载器的
 * 实时声明读，插件不存副本。modeRoster 只在显式重载时失效，角色的挂/卸不会让它失效，
 * 所以写路径不必等 Host Loader。
 *
 * @module dsh-agent-team-roles/host/modes
 */
import { DEFAULT_MODE, MODES, isModeId, normalizeMode, shippedLabel } from '../template.js'
import { presetDeclarations, templateFromDeclaration } from '../live-template.js'
import { loadDeployment } from '../deployment.js'

/** @param {object} h 共享宿主状态 @returns {object} 模式与快照读取 API */
export function createModes(h) {
/** 加载器当前持有的全部 preset 声明，按 preset id 索引。
 * 每次调用都重读：用户随时可能增删预设，而读它没有 IO 成本。 */
  const liveDeclarations = () => presetDeclarations(h.ctx.loader)

/** 一个模式的组合，直接从部署加载的 preset 声明读；不缓存也不拷贝，
 * 用户随时可能改预设，下一次组合必须看到改动。
 * @param {string} id @returns {object | null} */
  const resolveSnapshot = (id) => {
    const declaration = liveDeclarations().get(id)
    return declaration === undefined ? null : templateFromDeclaration(declaration)
  }

/** 部署的 agent preset 名册，也就是模式清单：用户能在预设编辑器里改的，就是模式选择器里能选的。
 * 过滤两类：本插件自己的角色预设（角色不是模式），以及不合法的 id。
 * @returns {Promise<object[]>} */
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
// 按「是不是我们的角色」排除，而不是按有没有挂载：改完还没挂的角色仍不是模式。
// store.roles 与 registered 取并集，所以挂/卸角色都不会让这份缓存失效。
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

/** 提交的 mode 可用的 id 集合：名册里的全部，读不到名册时退化为自带的四个。
 * @returns {Promise<string[]>} */
  const knownModeIds = async () => {
    const roster = await readRoster()
    return roster.length > 0 ? roster.map((entry) => entry.id) : MODES.map((mode) => mode.id)
  }

/** 一个模式给角色用的组合；每次调用都从加载器声明重建，用户仍在编辑的预设必须能变。
 * @param {string} [mode] @returns {Promise<object>} */
  const ensureTemplate = async (mode = DEFAULT_MODE) => {
    const id = normalizeMode(mode)
    const template = resolveSnapshot(id)
    if (template === null) {
      throw new Error(`这个部署里没有 ${id} 这个模式：加载器里没有它的预设声明`)
    }
    return template
  }

/** 界面模式选择器的候选：就是部署的 preset 列表，增删 preset 即改变候选。
 * 标签优先用 preset 自己的 name，其次本插件知道的四个自带名，最后回落到 id。
 * @returns {Promise<object[]>} */
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

/** 让下一次读模式清单重新问一遍部署（显式「重载」用）。 */
  const invalidateRoster = () => {
    h.modeRoster = null
  }

  return { liveDeclarations, resolveSnapshot, readRoster, knownModeIds, ensureTemplate, describeModes, ensureDeployment, invalidateRoster }
}
