/**
 * dsh-agent-team-roles — host half / 角色注册的生命周期（§5.54、§5.58 A5）。
 *
 * §5.54 的核心分界线：角色的定义是**元数据**，挂载是「用到时才发生」的副作用。
 * 用户 m17251 的口径是「勾一个技能就是改一次 JSON，改配置本身不该去重建任何东西；
 * 谁要用这个角色，谁在那一刻把它挂起来」。于是：
 *
 * - `planned` 是这次配置算出来的**期望定义**（纯内存，不碰注册表）；
 * - `mountedFingerprint` 记下每个角色**已经挂上去的那份定义**的指纹，指纹不同
 *   就说明「改过但还没挂」；
 * - `health` 是最近一次挂载后从注册表读到的诊断（`broken`），只在挂载后刷新，
 *   读状态时不再去问注册表（那会顺带 await 整个 Host Loader）。
 *
 * 这一文件把「算定义 → 卸/挂 → 记指纹 → 刷诊断 → 后台合并重建 → 按需补挂」整条链
 * 收在一起，因为它们是同一份状态的写者；读路径（`state.js`）只读结果。
 *
 * @module dsh-agent-team-roles/host/lifecycle
 */
import { DEFAULT_MODE, normalizeMode } from '../template.js'
import { buildDefinitions } from '../roles.js'
import { resolveRoleSkillDirs, scanSkills } from '../skills.js'

/**
 * @param {object} h - the shared host state ({@link ./context.js}).
 * @param {object} modes - the mode/snapshot read API ({@link ./modes.js}).
 * @returns {object} the lifecycle API.
 */
export function createLifecycle(h, modes) {
  /**
   * §5.54 — 把存储里的角色算成**期望定义**，只碰内存，不碰注册表。
   *
   * 这是「写配置」与「挂载」之间那条界线的内存一侧：算定义要扫一次技能目录
   * （§5.47 的 `skill-filesystem` 行要指到真实目录），但那是一次扫盘，不是
   * 每个角色一次挂载 + 一次全量审计。
   *
   * @returns {Promise<{ definitions: object[], skipped: object[] }>}
   */
  const planDefinitions = async () => {
    // Every mode a role names has to be in memory before the definitions are
    // built: `buildDefinition` resolves its snapshot synchronously, so a missing
    // one would be reported as a skipped role instead of a load error. A mode
    // that cannot be read falls back to `standard` rather than taking every
    // other role down with it, and says so in the log.
    for (const mode of new Set(h.store.roles.map((role) => normalizeMode(role.mode)))) {
      try {
        await modes.ensureTemplate(mode)
      } catch (error) {
        h.logger.warn(`预设 ${mode} 读取失败，该模式的角色改用 ${DEFAULT_MODE}：${String((error && error.message) || error)}`)
      }
    }

    // `dirOf` is what points each role's `agent-instructions` row at that
    // role's own directory (§5.30) — the directory *is* the wiring, so the
    // composition cannot be built without it. The deployment snapshot is no
    // longer part of a definition: no role carries a loop row any more.
    //
    // The resolver is `resolveSnapshot`, not `templates.get` (§5.40): a mode
    // with no snapshot file composes from the Loader's declaration, and reading
    // the cache directly would silently give every such role 标准模式's rows.
    // §5.47 — the directories every picking role points its `skill-filesystem`
    // row at. Resolved here (async) rather than inside `buildDefinition`, which
    // is synchronous on purpose: composing a preset must not read the disk while
    // it mounts. A scan that fails degrades to "no picked skills mounted" and
    // says so, instead of taking the whole registration pass down.
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

  /** §5.54 — 定义的指纹：用它判断「改过但还没挂」。 */
  const fingerprintOf = (definition) => JSON.stringify(definition)

  /** 这个角色改过但还没挂上去吗？ */
  const isDeferred = (id) => {
    const definition = h.planned.get(id)
    if (definition === undefined) return false
    return !h.registered.has(id) || h.mountedFingerprint.get(id) !== fingerprintOf(definition)
  }

  /** 期望定义里所有「改过但还没挂」的角色 id。 */
  const deferredIds = () => [...h.planned.keys()].filter((id) => isDeferred(id))

  /**
   * 卸下一个角色：先把 disposer 从表里摘掉，再 dispose。
   *
   * `register()` 返回的 disposer 自己会删定义、把代际标 `retired`，并在没有使用者
   * 时收集掉（`…\dsh-agent-preset-registry\lib\index.js:511-524`）。
   *
   * @param {string} id
   */
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

  /**
   * 挂载一个角色，并把指纹记下来。
   *
   * 失败**不吞**：`register()` 对挂载失败是标记 `record.broken` 而不是抛
   * （`…\dsh-agent-preset-registry\lib\index.js:525-545`），所以这里只能看到它有没有
   * 抛；`broken` 由 `refreshHealth()` 在挂载后读一次注册表补上。
   *
   * @param {object} service
   * @param {object} definition
   * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
   */
  const registerOne = async (service, definition) => {
    await unregisterOne(definition.id)
    try {
      const dispose = await service.register(definition)
      if (h.disposed) {
        // §5.58 A5 — the plugin went away while the registry was answering.
        // `registered.clear()` has already run, so recording this handle would
        // leak a mounted preset that nothing owns any more. Release it here.
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

  /**
   * 从注册表读一次挂载诊断。
   *
   * 这是唯一会 `await` 整个 Host Loader 的地方：有 pending 行时 `diagnostic()` 会
   * 先等 Loader 落定（`…\dsh-agent-preset-registry\lib\index.js:557-568`）。所以它只在
   * **真的动过注册表之后**跑，而不是每次读状态都跑。
   *
   * @param {object} service
   */
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

  /**
   * §5.54 — 显式同步：让注册表与存储完全一致（启动时、设置页的「同步」/「重载」）。
   *
   * 慢的来源只有一处：**指纹没变的角色不再拆了重挂**。
   * 一次勾选只改一个角色，就只有那一个角色走 teardown/mount。
   *
   * @param {object} service - the `agentPresets` service.
   * @returns {Promise<{ applied: string[], removed: string[], failures: object[], skipped: object[], deferred: string[] }>}
   */
  const sync = async (service) => {
    const { definitions, skipped } = await planDefinitions()
    const wanted = new Set(definitions.map((definition) => definition.id))

    /** @type {string[]} */
    const removed = []
    for (const id of [...h.registered.keys()]) {
      if (wanted.has(id)) continue
      removed.push(id)
      await unregisterOne(id)
    }

    /** @type {string[]} */
    const applied = []
    /** @type {object[]} */
    const failures = []

    for (const definition of definitions) {
      if (!isDeferred(definition.id)) continue
      const outcome = await registerOne(service, definition)
      if (outcome.ok) applied.push(definition.id)
      else failures.push({ id: definition.id, reason: outcome.reason })
    }

    // 只刷健康诊断（那才需要看注册表）；名册缓存不动：角色的挂/卸不会改变部署的模式
    // 清单（`readRoster` 按角色 id 排除），而这份缓存正是写路径不再等 Host Loader 的关键。
    if (applied.length > 0 || removed.length > 0) await refreshHealth(service)
    return { applied, removed, failures, skipped, deferred: deferredIds() }
  }

  /** §5.54 — 后台重建的合并窗口：连点落成一次。 */
  const REBUILD_DELAY_MS = 200

  /**
   * §5.54 — 后台把「改过的角色」挂起来（合并后只跑一次）。
   *
   * @returns {Promise<void>}
   */
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

  /**
   * §5.54 — 给写路径安排一次后台重建（回包不等它）。
   *
   * @param {object} service
   */
  const scheduleRebuild = (service) => {
    if (service === null || service === undefined) return
    h.rebuildService = service
    if (h.rebuildTimer !== null) clearTimeout(h.rebuildTimer)
    h.rebuildTimer = setTimeout(() => {
      void flushRebuild()
    }, REBUILD_DELAY_MS)
    // 定时器不该把进程钉住（headless 测试里尤其重要）。
    if (typeof h.rebuildTimer.unref === 'function') h.rebuildTimer.unref()
  }

  /** §5.54 — 卸载时取消还没跑的后台重建。 */
  const cancelRebuild = () => {
    if (h.rebuildTimer !== null) clearTimeout(h.rebuildTimer)
    h.rebuildTimer = null
    h.rebuildService = null
  }

  /**
   * §5.54 — **写配置**（勾技能、开关行、改模式、还原、增删角色）。
   *
   * 只做两件事：把内存里的期望定义算出来、把不再存在的角色卸掉。改过的角色只被记为
   * 「待挂载」，谁要用它谁去挂（`ensureRegistered`）。于是用户点一次勾选的代价从
   * 「重挂所有角色 + 全量审计」降到一次扫盘 + 一次纯内存计算，回包不等重建。
   *
   * @param {object} service - the `agentPresets` service，只用来安排后台重建。
   * @returns {Promise<object>}
   */
  const commit = async (service) => {
    const { definitions, skipped } = await planDefinitions()
    const wanted = new Set(definitions.map((definition) => definition.id))

    /** @type {string[]} */
    const removed = []
    for (const id of [...h.registered.keys()]) {
      if (wanted.has(id)) continue
      removed.push(id)
      await unregisterOne(id)
    }

    // 回包之后才重建（合并连点）：用户看到的是「改完即存」，不是「等 10 秒」。
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

  /**
   * §5.54 — 让某个角色「现在可用」：定义脏或没挂，就挂这一个角色。
   *
   * 成员创建窗口在 `select()` 之前调它，于是挂载发生在创建事务里、**早于**任何
   * `agent/created` 监听器。注册表里若还没有这个 id，`retain()` 会抛
   * `agent-preset/not-found`（`…\dsh-agent-preset-registry\lib\index.js:639-660`），
   * 所以这一步不能省。
   *
   * @param {object} service
   * @param {string} id
   * @returns {Promise<boolean>} 这个角色现在是不是可用
   */
  const ensureRegistered = async (service, id) => {
    if (service === null || service === undefined) return false
    const definition = h.planned.get(id)
    if (definition === undefined) return false
    if (!isDeferred(id)) return true
    const outcome = await registerOne(service, definition)
    if (!outcome.ok) return false
    h.logger.info(`角色 preset ${id} 已按需挂载（§5.54）`)
    // 诊断在后台补：它可能要等整个 Host Loader，不能塞进创建事务里。
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
