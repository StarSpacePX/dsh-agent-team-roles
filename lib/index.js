/**
 * dsh-agent-team-roles — host half.
 *
 * Gives the user a place to describe *roles* (one per agent-team member) and
 * turns each role into a separately selectable agent preset. dsh already knows
 * how to mount an agent preset; what it does not have in 0.1.7 is an authoring
 * side, and this plugin deliberately does not invent one: it registers presets
 * at runtime through the public `agentPresets` service and keeps its own data
 * in its own directory.
 *
 * Two rules from the requirements shape everything here:
 *
 *  - **只引用，不新增.** A role never invents capability rows. It is composed
 *    from the deployment's own preset for a mode — 标准 / PTC / 极简 / 创造, the
 *    mode the role names (§5.32) — read live out of the Loader (§5.62), with the
 *    role's own overrides on top, so every row the UI shows already exists in the
 *    deployment. The one row a role may
 *    add is the MCP gateway — the directed exception the user authorized on
 *    2026-09-27 — and even the role's own instruction file is wired by
 *    overriding an existing row's `config.dshHome` (§5.30), not by adding a row.
 *  - **不碰现有文件.** The plugin writes only inside its own directory — the
 *    index, and one `role.json` + `AGENTS.md` per role (§5.29) — and registers
 *    nothing through the profile patch.
 *
 * One thing the requirements asked for turned out to be impossible, and the
 * header of `deployment.js` records why: **no role may carry an `agent-loop`
 * row** (§5.30). Its panel is now a read-only 「角色工作目录」 note.
 *
 * 这个文件现在是**薄装配层**：它只做三件事 —— 判定平台门（网关第二次加载），
 * 建立共享状态 `h`，按固定顺序调用各模块的安装函数。所有实现在 `./host/*.js`：
 *
 *  - `host/config.js` — 配置归一化、模式/id 校验、网关配置解析、身份读取；
 *  - `host/http.js`   — 读 JSON、写 JSON、状态码、失败降级；
 *  - `host/gate.js`   — 两个平台门（MCP 与插件工具）；
 *  - `host/adopt.js`  — v1 迁移角色补 `AGENTS.md` 目录；
 *  - `host/modes.js`  — 模式/快照解析与部署预设名册缓存；
 *  - `host/team.js`   — §5.33 团队开关与组合清单短缓存；
 *  - `host/lifecycle.js` — 角色注册、指纹、重建、按需挂载（§5.54）；
 *  - `host/patches.js` — 开关补丁（单行与批量共用同一套规则，§5.39）；
 *  - `host/state.js`  — `/state` 投影与正文缓存（§5.58 D2）；
 *  - `host/commands*.js` — `/command` 的动作表与调度；
 *  - `host/bind.js`   — 成员绑定（创建窗口 + 宣告期兜底，§5.53）；
 *  - `host/roster.js` — 名册/任务板/群聊日志（§5.43–§5.50）；
 *  - `host/routes.js` — HTTP 路由。
 *
 * @module dsh-agent-team-roles
 */
import { RoleStore } from './store.js'
import { applyMcpGate, applyToolGate } from './host/gate.js'
import { gateConfig, normalizeConfig } from './host/config.js'
import { createHost } from './host/context.js'
import { createModes } from './host/modes.js'
import { createTeam } from './host/team.js'
import { createLifecycle } from './host/lifecycle.js'
import { createState } from './host/state.js'
import { createCommands } from './host/commands.js'
import { installBind } from './host/bind.js'
import { installTeamRoster } from './host/roster.js'
import { installRoutes } from './host/routes.js'
import * as patches from './host/patches.js'

export const name = 'dsh-agent-team-roles'
export const inject = []

export { commandStatus, notReady, stateAfterWrite } from './host/http.js'
export { adoptMigratedRoles } from './host/adopt.js'

/**
 * @param {object} ctx
 * @param {object} config
 */
export function apply(ctx, config = {}) {
  const gate = gateConfig(config)
  if (gate !== null) {
    if (gate.mcp !== null) applyMcpGate(ctx, { deny: gate.mcp })
    if (gate.toolGate !== null) applyToolGate(ctx, { deny: gate.toolGate })
    return
  }

  const options = normalizeConfig(config)
  const logger = typeof ctx.logger === 'function' ? ctx.logger('agent-team-roles') : console
  const store = new RoleStore(options.dir)
  const h = createHost({ ctx, config, options, logger, store })

  // §5.55 — the deployment's global tool registry, read from *this* (root)
  // scope. `tools.schemas()` without a scope is the global view, which is both
  // the list the 「插件」 panel offers and the set the role-scoped gateway
  // resolves its deny names against. Kept as a live service reference rather
  // than a snapshot: the registry grows as plugins load, and a cached list would
  // quietly hide a tool the user just installed.
  /** @type {{ schemas?: () => object[] } | null} */
  ctx.inject(['tools'], (scoped) => {
    h.rootTools = scoped.tools ?? null
  })

  const modes = createModes(h)
  const team = createTeam(h)
  const lifecycle = createLifecycle(h, modes)
  const state = createState(h, { modes, team, lifecycle })
  const commands = createCommands({ h, modes, lifecycle, patches, state, team })

  // 安装顺序与拆分前的 inject 顺序逐字一致：tools → agentPresets（含创建窗口）
  // → agents/agentTeams → pluginManager → webServer。
  installBind(h, { lifecycle, team })
  installTeamRoster(h)
  team.installPluginManager(ctx)
  installRoutes(h, state, commands)
}
