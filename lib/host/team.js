/**
 * dsh-agent-team-roles — host half / 团队开关与部署组合清单的短缓存（§5.33、§5.54）。
 *
 * 「启用智能体团队」回答的是**部署**的问题：团队运行时是 dsh 自带的一个组合包
 * （`TEAM_BUNDLE`），只有 `pluginManager` 知道它装没装、选没选、是不是真的加载了。
 * 本插件存储里并没有这个开关。
 *
 * 而 `pluginManager.listBundles()` 是一次跨 Remote 的调用，实测独占 `/state` 的
 * 1038–2184 ms，且那一侧是同步读盘 —— 所以在请求里等它一次 = 整个宿主停一秒。
 * 这一文件就是那段「缓存 60 秒 + 过期后台续读 + 启动预热」的实现，以及团队开关本身。
 *
 * @module dsh-agent-team-roles/host/team
 */
import { TEAM_BUNDLE } from '../deployment.js'

/**
 * @param {object} h - the shared host state ({@link ./context.js}).
 * @returns {object} the team API.
 */
export function createTeam(h) {
  /**
   * §5.54 — 组合包清单的短缓存（面板刷新从 1.3 s 回到毫秒级的关键）。
   *
   * `pluginManager.listBundles()` 是一次跨 Remote 的调用：它同步读 profile 清单，
   * 再对每个组合包读一次 `package.json`。实测（3099，分段日志）它独占 `/state` 的
   * **1038–2184 ms**，而 `template/modes/deployment/mcp/skills/notes` 全部加起来
   * 只有 20–200 ms —— 也就是说「读一下状态」几乎全花在问一次部署组合清单上。
   *
   * 而且它那一侧是**同步**读盘（profile 清单 + 安装锚点 + 每个组合包的 package.json），
   * 所以在请求里读它一次 = 整个宿主停一秒。
   *
   * 它回答的是**部署**的属性（团队这个组合包装没装、选没选、什么版本）。事实是：
   * 换组合包必须重启 dsh 才生效，也就是说这份答案在进程生命周期里几乎不变，唯一会变的
   * 是「我们自己翻开关」。所以：
   * - 缓存 60 秒；过期只**后台续读**（stale-while-revalidate），而且续读排到 250 ms 之后，
   *   不在回包路径上 —— 面板任何时候读状态都拿到毫秒级的旧值，下一次刷新拿到新值；
   * - 我们自己翻开关时**当场改缓存里那一位**，不做二次读盘，回包也是毫秒级；
   * - 只有「重载」这个明确要求重读的动作才真的等一次。
   * 进程起来后的第一次读仍然等一次（没有别的答案可给）。
   */
  const TEAM_CACHE_MS = 60_000
  /** 过期后的那次后台续读晚这么多毫秒再开始，好让当前这次回包先发出去。 */
  const TEAM_REVALIDATE_DELAY_MS = 250

  /** 让下一次读状态重新问一遍部署组合清单（「重载」用：这一次会真的等一次）。 */
  const invalidateTeam = () => {
    h.teamCache = null
    h.teamPending = null
    if (h.teamTimer !== null) clearTimeout(h.teamTimer)
    h.teamTimer = null
    if (h.teamWarmTimer !== null) clearTimeout(h.teamWarmTimer)
    h.teamWarmTimer = null
  }

  /**
   * §5.55 — user m18765「这个读取要好几秒是什么意思？」.
   *
   * The settings page shows 「正在读取角色…」 until this process's **first** `/state`
   * answers, and that answer is the one that has to ask the deployment for its
   * bundle roster. `pluginManager.listBundles()` is a `@Remote` call: the first
   * one loads the host-side module, then reads the profile manifest plus every
   * bundle's `package.json` **synchronously on the host**
   * (`…\dsh-plugin-manager\lib\types\index.js:277-311`). 3099 实测冷读 ≈3.7 s
   * （一个进程只付一次，热读 ≈0 ms）—— 那 3.7 秒就是「好几秒」。
   *
   * The roster is a property of the deployment: it cannot change without a dsh
   * restart, and our own toggle patches the cache in place. So read it once
   * ourselves, a couple of seconds after this plugin is up, while nobody is
   * waiting for it — the first look at the panel then finds it already cached.
   */
  const TEAM_WARMUP_DELAY_MS = 2_000

  /** 排一次启动后的预热读；已经读过或已经排上就不重复排。 */
  const warmTeamCache = () => {
    if (h.teamCache !== null || h.teamWarmTimer !== null) return
    h.teamWarmTimer = setTimeout(() => {
      h.teamWarmTimer = null
      if (h.teamCache === null) void startTeamRead().catch(() => {})
    }, TEAM_WARMUP_DELAY_MS)
    // 定时器不该把进程钉住。
    if (typeof h.teamWarmTimer.unref === 'function') h.teamWarmTimer.unref()
  }

  /** §5.54 — 排一次过期后的后台续读；已经排上就不重复排。 */
  const scheduleTeamRevalidate = () => {
    if (h.teamTimer !== null) return
    h.teamTimer = setTimeout(() => {
      h.teamTimer = null
      void startTeamRead().catch(() => {})
    }, TEAM_REVALIDATE_DELAY_MS)
    // 定时器不该把进程钉住。
    if (typeof h.teamTimer.unref === 'function') h.teamTimer.unref()
  }

  /**
   * §5.54 — 翻「启用智能团队」之后，把缓存里那一位当场改掉。
   *
   * 刚写成功的这一位就是自己写的，没有第二个写者会同时改它；为了它再读一遍那份
   * 1.2 秒的组合清单，正是这次改造要去掉的东西。
   *
   * @param {boolean} enabled
   */
  const rememberTeamEnabled = (enabled) => {
    if (h.teamCache === null || h.teamCache.value?.available !== true) {
      invalidateTeam()
      return
    }
    h.teamCache = { at: Date.now(), value: { ...h.teamCache.value, enabled } }
  }

  /**
   * Read the deployment's roster once (shared by every caller in the same tick).
   *
   * @returns {Promise<object>}
   */
  const startTeamRead = () => {
    if (h.teamPending === null) {
      h.teamPending = readTeamFresh().then(
        (value) => {
          h.teamCache = { at: Date.now(), value }
          h.teamPending = null
          return value
        },
        (error) => {
          h.teamPending = null
          throw error
        },
      )
    }
    return h.teamPending
  }

  /**
   * @returns {Promise<object>} the team block, read once and reused for
   * `TEAM_CACHE_MS`; an expired entry is re-read **in the background** so a state
   * read never waits on the deployment's bundle manager.
   */
  const readTeam = async () => {
    if (h.teamCache === null) return startTeamRead()
    if (Date.now() - h.teamCache.at >= TEAM_CACHE_MS) scheduleTeamRevalidate()
    return h.teamCache.value
  }

  /**
   * Whether the agent-team runtime is on in this profile (§5.33) — the uncached
   * read, wrapped by `readTeam` just above.
   *
   * The answer belongs to the *deployment*, not to this plugin's own storage:
   * the team runtime is a dsh bundle (`TEAM_BUNDLE`), and only `pluginManager`
   * knows whether it is installed, selected and actually loaded. Everything here
   * is read-only — a state read never flips a switch.
   *
   * Four shapes come back, and the UI must tell them apart:
   * - no service: this deployment has no `pluginManager`, so there is nothing to
   *   ask and the switch is disabled rather than merely off;
   * - not offered: the installation does not carry the bundle at all;
   * - offered but not selected: the real "team is off";
   * - selected: on.
   *
   * @returns {Promise<object>} the team block of the state.
   */
  const readTeamFresh = async () => {
    if (h.pluginManager === null) {
      return {
        bundle: TEAM_BUNDLE,
        available: false,
        reason: h.pluginManagerError ?? '这个部署里没有 pluginManager 服务，无法读写 profile 的组合',
      }
    }

    try {
      const bundles = await h.pluginManager.listBundles()
      const row = (bundles ?? []).find((bundle) => bundle?.name === TEAM_BUNDLE)
      if (row === undefined) {
        return {
          bundle: TEAM_BUNDLE,
          available: false,
          reason: `这个 dsh 安装没有提供组合包 ${TEAM_BUNDLE}`,
        }
      }
      return {
        bundle: TEAM_BUNDLE,
        available: true,
        // 「已装」与「已选」是两件事：安装自带这个组合包，所以 installed 多半是
        // true，而用户真正要看的开关是 enabled。
        installed: row.installed === true,
        enabled: row.enabled === true,
        removable: row.removable === true,
        readOnlyReason: row.readOnlyReason ?? null,
        description: row.description ?? null,
        version: row.version ?? null,
        error: row.error ? String(row.error.diagnostic ?? row.error.code ?? row.error) : null,
      }
    } catch (error) {
      return {
        bundle: TEAM_BUNDLE,
        available: false,
        reason: `读取 profile 组合失败：${String((error && error.message) || error)}`,
      }
    }
  }

  /**
   * Turn the agent-team runtime on or off through the deployment's own manager.
   *
   * Two writes, on purpose, and the order matters:
   * 1. the bundle selection, which is what actually starts the team runtime —
   *    asked of `pluginManager`, the service that owns the profile files;
   * 2. this plugin's own `bindMembers` switch, because「角色」只有在团队运行时
   *    里才有人可以绑定 — a role preset with no members is a preset nobody runs.
   *    Turning the team off clears it again, so the two can never disagree in the
   *    state the UI shows.
   *
   * The result is passed through verbatim: `application` is `applied` on a live
   * profile and `restart-required` otherwise, and that distinction is the honest
   * part of the answer — the UI must not claim a restart happened.
   *
   * @param {boolean} enabled
   * @returns {Promise<object>}
   */
  const setTeam = async (enabled) => {
    if (h.pluginManager === null) {
      throw new Error(
        `${h.pluginManagerError ?? '这个部署里没有 pluginManager 服务'}，因此无法${enabled ? '启用' : '关闭'}智能体团队（需要重启 dsh，或在 profile 里启用 pluginManager）`,
      )
    }

    // 预检用缓存里那一份：翻开关不该为了「确认它可翻」再读一次 1.2 秒的组合清单。
    // 拿不到答案（冷启动）时才真的读一次。
    const current = await readTeam()
    if (current.available !== true) {
      throw new Error(
        `${current.reason ?? `这个 dsh 安装没有提供组合包 ${TEAM_BUNDLE}`}，无法${enabled ? '启用' : '关闭'}智能体团队`,
      )
    }
    // A bundle the manager refuses to touch (a protected management bundle, a
    // stale approval …) is refused with a reason; repeating that reason beats a
    // bare failure.
    if (current.readOnlyReason !== null && current.readOnlyReason !== undefined && current.enabled !== enabled) {
      throw new Error(`profile 组合不可改：${String(current.readOnlyReason)}`)
    }

    const result = await h.pluginManager.setBundleEnabled(TEAM_BUNDLE, enabled)
    // §5.54 — 我们自己翻了开关：把缓存里那一位当场改掉，不重新读一遍部署。
    rememberTeamEnabled(enabled)
    await h.store.setSetting('bindMembers', enabled)

    const application =
      result?.application === 'applied'
        ? '已生效'
        : result?.application === 'restart-required'
          ? '已保存，重启 dsh 后生效'
          : String(result?.application ?? '未知')

    if (result?.error) {
      h.logger.warn(`切换智能体团队失败：${String(result.error.diagnostic ?? result.error.code ?? result.error)}`)
    } else {
      h.logger.info(`智能体团队${enabled ? '已启用' : '已关闭'}（${application}）`)
    }

    return {
      changed: result?.changed === true,
      application: result?.application ?? null,
      applicationLabel: application,
      stage: result?.stage ?? null,
      target: result?.target ?? TEAM_BUNDLE,
      error: result?.error ? String(result.error.diagnostic ?? result.error.code ?? result.error) : null,
      warnings: Array.isArray(result?.warnings) ? result.warnings.map(String) : [],
    }
  }

  /**
   * §5.33 — the deployment's own bundle manager, wanted for exactly one thing:
   * the team runtime switch. It is injected separately from `agentPresets` and
   * `webServer` so a profile without it still serves roles and the panel, with
   * the switch offering an explanation instead of a click that cannot work.
   *
   * @param {object} ctx
   */
  const installPluginManager = (ctx) => {
    ctx.inject(['pluginManager'], (scoped) => {
      h.pluginManager = scoped.pluginManager
      h.pluginManagerError = null
      scoped.effect(
        () => () => {
          h.pluginManager = null
        },
        'agent-team-roles: pluginManager',
      )
    })
  }

  return { invalidateTeam, warmTeamCache, rememberTeamEnabled, readTeam, setTeam, installPluginManager }
}
