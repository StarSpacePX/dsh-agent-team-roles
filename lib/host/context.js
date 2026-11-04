/**
 * dsh-agent-team-roles — host half / 共享运行期状态（§5.54）。
 *
 * 共享状态收敛成这一个对象，各模块只持有它的引用，读写照旧
 * （`h.presets`、`h.registered` …）：谁在什么时候改它、谁是延迟绑定的，
 * 都由这一个对象的生命周期决定。
 *
 * 这里只放「状态 + 一个跨模块的小工具」，不放任何业务逻辑。
 *
 * @module dsh-agent-team-roles/host/context
 */

/**
 * @param {{ ctx: object, config: object, options: object, logger: object, store: object }} seed
 * @returns {object} the shared host state.
 */
export function createHost(seed) {
  return {
    // —— 装配期就定下来的只读引用 ——
    ctx: seed.ctx,
    config: seed.config,
    options: seed.options,
    logger: seed.logger,
    store: seed.store,

    // —— §5.55 根作用域的工具注册表（inject 里填，可能是 null） ——
    /** @type {{ schemas?: () => object[] } | null} */
    rootTools: null,

    // —— 读路径的缓存 ——
    /** @type {{ source: object, loop: object | null } | null} */
    deployment: null,
    /** @type {object | null} `agentPresets` 服务（inject 里填） */
    presets: null,
    /** @type {object | null} `pluginManager` 服务（§5.33，inject 里填） */
    pluginManager: null,
    /** @type {string | null} */
    pluginManagerError: null,
    /** 部署预设名册缓存（模式清单）；`null` = 需要重新读一次。 @type {object[] | null} */
    modeRoster: null,

    // —— §5.45 / §5.50 宿主半的两个闭包（inject 里填） ——
    /** @type {((request: { sessionId: string, target: string, body: string }) => Promise<object>) | null} */
    teamSend: null,
    /** @type {((request: { sessionId: string }) => object) | null} */
    teamLogReader: null,
    /** @type {Map<string, { log: object, scanned: number }>} */
    teamLogs: new Map(),

    // —— §5.54 角色注册的元数据 ——
    /** @type {Map<string, () => Promise<void>>} */
    registered: new Map(),
    /** §5.58 A5 — 由 `agentPresets` 的 disposer 置位，不再复位。 */
    disposed: false,
    /** @type {Map<string, object>} 角色 id → 期望中的定义 */
    planned: new Map(),
    /** @type {Map<string, string>} 角色 id → 已挂载定义的指纹 */
    mountedFingerprint: new Map(),
    /** @type {Map<string, string | undefined>} 角色 id → 最近一次挂载诊断（undefined = 好） */
    health: new Map(),
    /** 最近一次读注册表诊断的失败原因，或 null。 @type {string | null} */
    healthError: null,
    /** @type {ReturnType<typeof setTimeout> | null} 后台重建的合并定时器 */
    rebuildTimer: null,
    /** @type {object | null} 后台重建要用哪个 `agentPresets` 服务 */
    rebuildService: null,
    /** Mutations are serialized: two UI clicks must not interleave a read-modify-write. */
    queue: Promise.resolve(),

    // —— §5.54 部署组合清单的短缓存（§5.33 团队开关） ——
    /** @type {{ at: number, value: object } | null} */
    teamCache: null,
    /** 同一个 tick 里两个请求同时发现缓存过期时，共用这一次读取。 @type {Promise<object> | null} */
    teamPending: null,
    /** 已经排上的那次后台续读。 @type {NodeJS.Timeout | null} */
    teamTimer: null,
    /** 启动后的预热读定时器。 @type {NodeJS.Timeout | null} */
    teamWarmTimer: null,

    // —— §5.58 A4/D2 `/state` 的缓存与降级 ——
    /** @type {object | null} the last state that rendered */
    lastGoodState: null,
    stateRevision: 0,
    /** @type {{ stamp: string, etag: string, body: string } | null} */
    stateCache: null,

    /**
     * @template T
     * @param {() => Promise<T>} task
     * @returns {Promise<T>}
     */
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
