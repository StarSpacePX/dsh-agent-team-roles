/**
 * 角色注册的生命周期。
 *
 * 分界线：角色定义是元数据，挂载是「用到时才发生」的副作用。
 * - planned：这次配置算出的期望定义，纯内存，不碰注册表；
 * - mountedFingerprint：每个角色已经挂上去那份定义的指纹，不同即「改过但还没挂」；
 * - health：最近一次挂载后从注册表读到的诊断，只在挂载后刷新。
 *
 * @module dsh-agent-team-roles/host/lifecycle
 */
import { DEFAULT_MODE, normalizeMode } from '../template.js'
import { buildDefinitions } from '../roles.js'
import { resolveRoleSkillDirs, scanSkills } from '../skills.js'

/** @param {object} h 共享宿主状态 @param {object} modes 模式与快照读取 API
 * @returns {object} 生命周期 API */
export function createLifecycle(h, modes) {
/** 把存储里的角色算成期望定义：只碰内存，不碰注册表
 * （要扫一次技能目录，因为 skill-filesystem 行得指到真实目录）。
 * @returns {Promise<{ definitions: object[], skipped: object[] }>} */
  const planDefinitions = async () => {
// 定义构建前先把所有 mode 读进内存：buildDefinition 同步解析快照，缺一个会被报成跳过角色。
// 读不到的 mode 回落 standard 并在日志里说明，不拖垮其它角色。
    for (const mode of new Set(h.store.roles.map((role) => normalizeMode(role.mode)))) {
      try {
        await modes.ensureTemplate(mode)
      } catch (error) {
        h.logger.warn(`预设 ${mode} 读取失败，该模式的角色改用 ${DEFAULT_MODE}：${String((error && error.message) || error)}`)
      }
    }

// dirOf 把每个角色的指令行指向它自己的目录——目录就是接线，没有它就组不出组合。
// 快照按 mode 现取（resolveSnapshot），不是每次从 templates 拷。
    let skillScan = { roots: [], skills: [], error: null }
    try {
      skillScan = await scanSkills({ home: h.options.home })
    } catch (error) {
      h.logger.warn(`技能目录扫描失败，本轮按角色挑选的技能不会挂载：${String((error && error.message) || error)}`)
    }
    const skillDirs = resolveRoleSkillDirs(h.store.roles, skillScan)

    const { definitions, skipped } = buildDefinitions(
      h.store.roles,
      (mode) => modes.resolveSnapshot(normalizeMode(mode)) ?? modes.resolveSnapshot(DEFAULT_MODE),
      process.platform,
      {
        dirOf: (id) => h.store.roleDirOf(id),
        skillDirOf: (id) => skillDirs.get(id)?.dirs ?? [],
      },
    )
    h.planned.clear()
    for (const definition of definitions) h.planned.set(definition.id, definition)
    return { definitions, skipped }
  }

/** 定义的指纹：用来判断「改过但还没挂」。 */
  const fingerprintOf = (definition) => JSON.stringify(definition)

/** 该角色是否改过但还没挂。 */
  const isDeferred = (id) => {
    const definition = h.planned.get(id)
    if (definition === undefined) return false
    return !h.registered.has(id) || h.mountedFingerprint.get(id) !== fingerprintOf(definition)
  }

/** 期望定义里所有改过但还没挂的角色 id。 */
  const deferredIds = () => [...h.planned.keys()].filter((id) => isDeferred(id))

/** 卸下一个角色：先从表里摘 disposer，再 dispose。
 * @param {string} id */
  const unregisterOne = async (id) => {
    const dispose = h.registered.get(id)
    if (dispose === undefined) return
    h.registered.delete(id)
    h.mountedFingerprint.delete(id)
    h.health.delete(id)
    try {
      await dispose()
    } catch (error) {
      h.logger.warn(`角色 preset ${id} 卸载失败：${String((error && error.message) || error)}`)
    }
  }

/** 挂载一个角色并记下指纹。
 * register() 对挂载失败只标 record.broken、不抛错，所以 ok 不代表挂成功；
 * broken 由 refreshHealth 在挂载后补读。
 * @param {object} service @param {object} definition
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>} */
  const registerOne = async (service, definition) => {
    await unregisterOne(definition.id)
    try {
      const dispose = await service.register(definition)
      if (h.disposed) {
// 插件在注册表回答期间被卸载：registered 已清空，再记这个句柄会漏掉一个没人负责的已挂预设，直接释放。
        try {
          if (typeof dispose === 'function') await dispose()
        } catch (error) {
          h.logger.warn(
            `卸载后回滚 preset ${definition.id} 失败：${String((error && error.message) || error)}`,
          )
        }
        return { ok: false, reason: '插件已在注册期间卸载' }
      }
      h.registered.set(definition.id, dispose)
      h.mountedFingerprint.set(definition.id, fingerprintOf(definition))
      h.health.set(definition.id, undefined)
      return { ok: true }
    } catch (error) {
      const reason = String((error && error.message) || error)
      h.logger.warn(`角色 preset ${definition.id} 注册失败：${reason}`)
      return { ok: false, reason }
    }
  }

/** 从注册表读一次挂载诊断。内部可能要 await 整个 Host Loader，
 * 所以只在真的动过注册表之后调用。
 * @param {object} service */
  const refreshHealth = async (service) => {
    if (service === null || service === undefined || typeof service.list !== 'function') return
    try {
      const records = await service.list()
      const list = Array.isArray(records) ? records : Array.isArray(records?.presets) ? records.presets : []
      for (const record of list) {
        if (record === null || typeof record !== 'object') continue
        if (!h.registered.has(record.id)) continue
        h.health.set(record.id, typeof record.broken === 'string' && record.broken !== '' ? record.broken : undefined)
      }
      h.healthError = null
    } catch (error) {
      h.healthError = String((error && error.message) || error)
      h.logger.warn(`读预设诊断失败：${h.healthError}`)
    }
  }

/** 让注册表与存储完全一致（启动、同步、重载）：指纹没变的角色不拆也不重挂。
 * @param {object} service
 * @returns {Promise<{ applied: string[], removed: string[], failures: object[], skipped: object[], deferred: string[] }>} */
  const sync = async (service) => {
    const { definitions, skipped } = await planDefinitions()
    const wanted = new Set(definitions.map((definition) => definition.id))

    const removed = []
    for (const id of [...h.registered.keys()]) {
      if (wanted.has(id)) continue
      removed.push(id)
      await unregisterOne(id)
    }

    const applied = []
    const failures = []

    for (const definition of definitions) {
      if (!isDeferred(definition.id)) continue
      const outcome = await registerOne(service, definition)
      if (outcome.ok) applied.push(definition.id)
      else failures.push({ id: definition.id, reason: outcome.reason })
    }

// 只刷健康诊断（那才需要看注册表）；名册缓存不动——挂/卸角色不改变部署的模式清单。
    if (applied.length > 0 || removed.length > 0) await refreshHealth(service)
    return { applied, removed, failures, skipped, deferred: deferredIds() }
  }

/** 后台重建的合并窗口：连点只跑一次。 */
  const REBUILD_DELAY_MS = 200

/** 后台把「改过的角色」挂起来，合并后只跑一次。
 * @returns {Promise<void>} */
  const flushRebuild = async () => {
    const service = h.rebuildService
    h.rebuildTimer = null
    h.rebuildService = null
    if (service === null) return
    try {
      await sync(service)
    } catch (error) {
      h.logger.warn(`后台重建角色 preset 失败：${String((error && error.message) || error)}`)
    }
  }

/** 给写路径安排一次后台重建，回包不等它。
 * @param {object} service */
  const scheduleRebuild = (service) => {
    if (service === null || service === undefined) return
    h.rebuildService = service
    if (h.rebuildTimer !== null) clearTimeout(h.rebuildTimer)
    h.rebuildTimer = setTimeout(() => {
      void flushRebuild()
    }, REBUILD_DELAY_MS)
// 定时器不该把进程钉住，headless 测试里尤其明显。
    if (typeof h.rebuildTimer.unref === 'function') h.rebuildTimer.unref()
  }

/** 卸载时取消还没跑的后台重建。 */
  const cancelRebuild = () => {
    if (h.rebuildTimer !== null) clearTimeout(h.rebuildTimer)
    h.rebuildTimer = null
    h.rebuildService = null
  }

/** 写配置（勾技能、开关行、改模式、还原、增删角色）：只算内存里的期望定义、
 * 卸掉已不存在的角色，改过的角色记为待挂载，回包不等重建。
 * @param {object} service @returns {Promise<object>} */
  const commit = async (service) => {
    const { definitions, skipped } = await planDefinitions()
    const wanted = new Set(definitions.map((definition) => definition.id))

    const removed = []
    for (const id of [...h.registered.keys()]) {
      if (wanted.has(id)) continue
      removed.push(id)
      await unregisterOne(id)
    }

// 回包之后再重建（合并连点）：用户看到的是「改完即存」，不是等重建。
    scheduleRebuild(service)

    return {
      applied: [],
      removed,
      failures: [],
      skipped,
      deferred: deferredIds(),
      deferredReason: '改完即存：角色定义已更新，后台立刻重建，最迟在下次用到该角色时挂载（§5.54）',
    }
  }

/** 让某个角色「现在可用」：定义脏或没挂，就挂这一个。
 * 成员创建窗口在 select() 之前调它，挂载因此发生在创建事务里、早于任何 agent/created 监听器。
 * @param {object} service @param {string} id
 * @returns {Promise<boolean>} 该角色现在是否可用 */
  const ensureRegistered = async (service, id) => {
    if (service === null || service === undefined) return false
    const definition = h.planned.get(id)
    if (definition === undefined) return false
    if (!isDeferred(id)) return true
    const outcome = await registerOne(service, definition)
    if (!outcome.ok) return false
    h.logger.info(`角色 preset ${id} 已按需挂载`)
// 诊断在后台补：它可能要等整个 Host Loader，不能塞进创建事务。
    void refreshHealth(service)
    return true
  }

  return {
    planDefinitions,
    fingerprintOf,
    isDeferred,
    deferredIds,
    unregisterOne,
    registerOne,
    refreshHealth,
    sync,
    flushRebuild,
    scheduleRebuild,
    cancelRebuild,
    commit,
    ensureRegistered,
  }
}
