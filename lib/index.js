/**
 * dsh-agent-team-roles 宿主侧。
 *
 * 给用户一个描述「角色」（一个成员一个角色）的地方，并把每个角色变成一个可单独选择的
 * agent preset：通过公开的 agentPresets 服务在运行时注册，数据只写在自己的目录里。
 *
 * 两条约束贯穿全文：
 * - 只引用，不新增：角色的行来自部署自己的 mode preset，只叠加覆盖；唯一允许新增的是 MCP
 *   网关行，自己的 AGENTS.md 也是靠覆盖已有行的 config.dshHome 接上去的。
 * - 不碰现有文件：只写自己的目录（索引 + 每个角色的 role.json 与 AGENTS.md），不写 profile 补丁。
 *
 * 本文件是薄装配层：只判定平台门、建立共享状态 h、按固定顺序调用各模块的安装函数。
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

/** @param {object} ctx @param {object} config */
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

// 根作用域的全局工具注册表：不带作用域的 tools.schemas() 是全局视图，既是「插件」面板的清单，
// 也是角色级网关解析 deny 名的依据。保留活引用而非快照——插件边加载边注册，快照会悄悄过期。
  ctx.inject(['tools'], (scoped) => {
    h.rootTools = scoped.tools ?? null
  })

  const modes = createModes(h)
  const team = createTeam(h)
  const lifecycle = createLifecycle(h, modes)
  const state = createState(h, { modes, team, lifecycle })
  const commands = createCommands({ h, modes, lifecycle, patches, state, team })

// 安装顺序与拆分前一致：tools → agentPresets（含创建窗口）→ agents/agentTeams → pluginManager → webServer。
  installBind(h, { lifecycle, team })
  installTeamRoster(h)
  team.installPluginManager(ctx)
  installRoutes(h, state, commands)
}
