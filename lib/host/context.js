/**
 * 共享运行期状态：各模块只持有这一个对象的引用（h.presets、h.registered …），
 * 谁在什么时候改它、谁是延迟绑定，都由这个对象的生命周期决定。
 * 这里只放状态与一个跨模块小工具，不放业务逻辑。
 *
 * @module dsh-agent-team-roles/host/context
 */

/** @param {{ ctx: object, config: object, options: object, logger: object, store: object }} seed
 * @returns {object} 共享宿主状态 */
export function createHost(seed) {
  return {
// —— 装配期就定下来的只读引用 ——
    ctx: seed.ctx,
    config: seed.config,
    options: seed.options,
    logger: seed.logger,
    store: seed.store,

// —— 根作用域的工具注册表（inject 里填，可能为 null） ——
    rootTools: null,

// —— 读路径的缓存 ——
    deployment: null,
/** agentPresets 服务（inject 里填） */
    presets: null,
/** pluginManager 服务（inject 里填） */
    pluginManager: null,
    pluginManagerError: null,
/** 部署预设名册缓存（模式清单）；null 表示需要重读一次 */
    modeRoster: null,

// —— 宿主侧的两个闭包（inject 里填） ——
    teamSend: null,
    teamLogReader: null,

// —— 角色注册的元数据 ——
    registered: new Map(),
/** 由 agentPresets 的 disposer 置位，不再复位 */
    disposed: false,
/** 角色 id → 期望定义 */
    planned: new Map(),
/** 角色 id → 已挂载定义的指纹 */
    mountedFingerprint: new Map(),
/** 角色 id → 最近一次挂载诊断（undefined 表示好） */
    health: new Map(),
/** 最近一次读注册表诊断的失败原因，或 null */
    healthError: null,
/** 后台重建的合并定时器 */
    rebuildTimer: null,
/** 后台重建要用哪个 agentPresets 服务 */
    rebuildService: null,
/** 写操作串行化：两次 UI 点击不能交错进同一次读改写 */
    queue: Promise.resolve(),

// —— 部署组合清单的短缓存（团队开关用） ——
    teamCache: null,
/** 同一 tick 内两个请求同时发现缓存过期时，共用这一次读取 */
    teamPending: null,
/** 已经排上的那次后台续读 */
    teamTimer: null,
/** 启动后的预热读定时器 */
    teamWarmTimer: null,

// —— /state 的缓存与降级 ——
    lastGoodState: null,
    stateRevision: 0,
/** 缓存的正文、stamp 与 ETag */
    stateCache: null,

/** @template T @param {() => Promise<T>} task @returns {Promise<T>} */
    serialize(task) {
      const next = this.queue.then(task, task)
      this.queue = next.then(
        () => undefined,
        () => undefined,
      )
      return next
    },
  }
}
