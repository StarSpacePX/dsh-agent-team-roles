/**
 * 团队开关与部署组合清单的短缓存。
 *
 * 「启用智能体团队」问的是部署：团队运行时是 dsh 自带的组合包（TEAM_BUNDLE），
 * 只有 pluginManager 知道它装没装、选没选、是不是真的加载了，本插件存储里没有这个开关。
 * listBundles() 是跨 Remote 的同步读盘调用（实测独占 /state 约 1.0~2.2 s），
 * 所以这里做「缓存 60 秒 + 过期后台续读 + 启动预热」。
 *
 * @module dsh-agent-team-roles/host/team
 */
import { TEAM_BUNDLE } from '../deployment.js'

/** @param {object} h 共享宿主状态 @returns {object} 团队 API */
export function createTeam(h) {
/** 组合包清单的短缓存。listBundles() 跨 Remote 同步读 profile 清单与每个包的 package.json，
 * 实测独占 /state 1038~2184 ms，而其余来源合计只有 20~200 ms —— 请求里等它一次就停一秒。 */
  const TEAM_CACHE_MS = 60_000
/** 过期后台续读延迟这么多毫秒，好让当前这次回包先发出去。 */
  const TEAM_REVALIDATE_DELAY_MS = 250

/** 让下一次读状态重新问一遍部署组合清单（「重载」用，这一次会真的等）。 */
  const invalidateTeam = () => {
    h.teamCache = null
    h.teamPending = null
    if (h.teamTimer !== null) clearTimeout(h.teamTimer)
    h.teamTimer = null
    if (h.teamWarmTimer !== null) clearTimeout(h.teamWarmTimer)
    h.teamWarmTimer = null
  }

/** 设置页要等本进程首次 /state 回包，而那次必须问部署要组合包清单，
 * 所以启动后预热一次，避免界面卡在「正在读取角色…」。 */
  const TEAM_WARMUP_DELAY_MS = 2_000

/** 排一次启动预热；已读过或已排上就不重复。 */
  const warmTeamCache = () => {
    if (h.teamCache !== null || h.teamWarmTimer !== null) return
    h.teamWarmTimer = setTimeout(() => {
      h.teamWarmTimer = null
      if (h.teamCache === null) void startTeamRead().catch(() => {})
    }, TEAM_WARMUP_DELAY_MS)
// 定时器不该把进程钉住。
    if (typeof h.teamWarmTimer.unref === 'function') h.teamWarmTimer.unref()
  }

/** 排一次过期后的后台续读；已排上就不重复。 */
  const scheduleTeamRevalidate = () => {
    if (h.teamTimer !== null) return
    h.teamTimer = setTimeout(() => {
      h.teamTimer = null
      void startTeamRead().catch(() => {})
    }, TEAM_REVALIDATE_DELAY_MS)
// 定时器不该把进程钉住。
    if (typeof h.teamTimer.unref === 'function') h.teamTimer.unref()
  }

/** 翻转「启用智能团队」后当场改掉缓存里的这一位：这一位是自己写的，没有别的写者。
 * @param {boolean} enabled */
  const rememberTeamEnabled = (enabled) => {
    if (h.teamCache === null || h.teamCache.value?.available !== true) {
      invalidateTeam()
      return
    }
    h.teamCache = { at: Date.now(), value: { ...h.teamCache.value, enabled } }
  }

/** 同一 tick 内共享的一次部署清单读取。
 * @returns {Promise<object>} */
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

/** @returns {Promise<object>} 团队块；缓存 TEAM_CACHE_MS，过期后在后台续读，读状态不等部署。 */
  const readTeam = async () => {
    if (h.teamCache === null) return startTeamRead()
    if (Date.now() - h.teamCache.at >= TEAM_CACHE_MS) scheduleTeamRevalidate()
    return h.teamCache.value
  }

/** 本 profile 的 agent-team 运行时是否打开（未加缓存的读，上面 readTeam 只是包了缓存）。
 * 答案属于部署而不是本插件，这里全部只读。 */
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
// 「已装」与「已选」是两件事：安装自带这个组合包，所以 installed 多半为 true，用户要看的开关是 enabled。
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

/** 通过部署自己的 manager 打开/关闭团队运行时。
 * 两次写，顺序重要：先改组合包选择（这一步才真正启动运行时），再改本插件的 bindMembers
 * （没有运行时，角色没有成员可绑定）。
 * @param {boolean} enabled @returns {Promise<object>} */
  const setTeam = async (enabled) => {
    if (h.pluginManager === null) {
      throw new Error(
        `${h.pluginManagerError ?? '这个部署里没有 pluginManager 服务'}，因此无法${enabled ? '启用' : '关闭'}智能体团队（需要重启 dsh，或在 profile 里启用 pluginManager）`,
      )
    }

// 预检用缓存里那一份：翻开关不该为了确认可翻再读一次 1.2 秒的清单；拿不到答案才真读。
    const current = await readTeam()
    if (current.available !== true) {
      throw new Error(
        `${current.reason ?? `这个 dsh 安装没有提供组合包 ${TEAM_BUNDLE}`}，无法${enabled ? '启用' : '关闭'}智能体团队`,
      )
    }
// manager 拒绝的组合包会带原因，原样透出比只说失败有用。
    if (current.readOnlyReason !== null && current.readOnlyReason !== undefined && current.enabled !== enabled) {
      throw new Error(`profile 组合不可改：${String(current.readOnlyReason)}`)
    }

    const result = await h.pluginManager.setBundleEnabled(TEAM_BUNDLE, enabled)
// 自己翻的开关：当场改缓存，不重读部署。
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

/** 部署自己的组合包 manager，只用一件事：团队运行时开关。
 * 与 agentPresets / webServer 分开注入，没有它的 profile 仍能提供角色与面板，
 * 开关只给解释而不是一个点了没用的按钮。
 * @param {object} ctx */
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
