/**
 * dsh-agent-team-roles — host half / 平台门（§5.25、§5.55）。
 *
 * 这是本插件被加载的**第二种方式**：某个角色关掉了 MCP 服务或插件工具时，
 * 它的预设里会带一行网关（`agent-team-mcp-gate` / `agent-team-tool-gate`），
 * 那一行会在**子代理自己的组合里**再把本模块挂一次，并带上 `config.mcpGate` /
 * `config.toolGate`。这个实例只做一件事——把指名的工具从本作用域继承的东西里藏起来——
 * 做完就 return，绝不碰角色仓库。
 *
 * 两个门都通过 `tools.restrict({ deny })` 实现，但解析方式不同：MCP 按**服务名前缀**，
 * 插件工具按**精确工具名**（`tools.schemas()` 只报名字和描述，没有字段说明是谁注册的）。
 *
 * @module dsh-agent-team-roles/host/gate
 */
import { RUN_CODE_NAME, mcpToolNames } from '../deployment.js'

/**
 * Mount the MCP visibility gate for one agent scope.
 *
 * This is the second way this plugin is loaded. A role that switched an MCP
 * server off carries a gateway row (`agent-team-mcp-gate`, §5.25), and that row
 * mounts *this* module again — inside the agent's own composition — with
 * `config.mcpGate`. The instance then does one thing and returns: it hides the
 * named servers' tools from everything this scope inherits.
 *
 * Why `restrict()` and not a second MCP client:
 *
 *  - `tools.restrict({ deny })` is documented as "restrict global tools for the
 *    calling agent scope", and a restriction filters what a scope *inherits* —
 *    which is exactly "this role must not see that server".
 *  - It rejects unknown names, so the deny list is resolved from the live
 *    registry at mount time instead of being stored. A server that is not
 *    connected yet simply contributes nothing to hide; there is nothing to
 *    filter, and the gate says so instead of failing the mount.
 *
 * @param {object} ctx
 * @param {{ deny: string[] }} gate - server names to hide.
 */
export function applyMcpGate(ctx, gate) {
  const logger = typeof ctx.logger === 'function' ? ctx.logger('agent-team-roles/mcp-gate') : console

  ctx.inject(['tools'], (scoped) => {
    scoped.effect(() => {
      const tools = scoped.tools
      if (tools === null || tools === undefined) return undefined
      if (typeof tools.schemas !== 'function' || typeof tools.restrict !== 'function') {
        logger.warn('tools 服务没有 schemas()/restrict()，MCP 开关未生效')
        return undefined
      }

      /** @type {string[]} */
      let names = []
      try {
        for (const schema of tools.schemas()) {
          const name = schema === null || schema === undefined ? '' : String(schema.name ?? '')
          if (name.length > 0) names.push(name)
        }
      } catch (error) {
        logger.warn(`读取工具清单失败，MCP 开关未生效：${String((error && error.message) || error)}`)
        return undefined
      }

      /** @type {string[]} */
      const deny = []
      for (const serverName of gate.deny) deny.push(...mcpToolNames(names, serverName))

      if (deny.length === 0) {
        logger.info(`MCP 开关：${gate.deny.join('、')} 目前没有已注册的工具，无需隐藏`)
        return undefined
      }

      let dispose
      try {
        dispose = tools.restrict({ deny })
      } catch (error) {
        logger.warn(`隐藏 MCP 工具失败：${String((error && error.message) || error)}`)
        return undefined
      }

      logger.info(`MCP 开关：已对 ${gate.deny.join('、')} 隐藏 ${deny.length} 个工具`)
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    }, 'agent-team-roles: mcp gate')
  })
}

/**
 * Mount the plugin-tool visibility gate for one agent scope (§5.55).
 *
 * Same second-loading shape as {@link applyMcpGate}: a role that switched a
 * plugin tool off carries an `agent-team-tool-gate` row, that row mounts this
 * module again — inside the agent's own composition — with `config.toolGate`,
 * and the instance hides exactly those names from everything this scope
 * inherits.
 *
 * Two differences from the MCP gate:
 *
 *  - The deny list carries **exact tool names**, not server names, because
 *    `tools.schemas()` reports a name and a description and nothing else — no
 *    field says which plugin registered a tool, so there is no prefix to resolve.
 *  - A name that is not registered *right now* is dropped instead of passed on.
 *    `tools.restrict()` throws on an unknown name, so one stale entry (a plugin
 *    the user uninstalled after setting the switch) would otherwise fail the
 *    whole mount. `run_code` is dropped for the same reason: the registry
 *    refuses to restrict it.
 *
 * @param {object} ctx
 * @param {{ deny: string[] }} gate - public tool names to hide.
 */
export function applyToolGate(ctx, gate) {
  const logger = typeof ctx.logger === 'function' ? ctx.logger('agent-team-roles/tool-gate') : console

  ctx.inject(['tools'], (scoped) => {
    scoped.effect(() => {
      const tools = scoped.tools
      if (tools === null || tools === undefined) return undefined
      if (typeof tools.schemas !== 'function' || typeof tools.restrict !== 'function') {
        logger.warn('tools 服务没有 schemas()/restrict()，插件开关未生效')
        return undefined
      }

      /** @type {Set<string>} */
      const live = new Set()
      try {
        for (const schema of tools.schemas()) {
          const name = schema === null || schema === undefined ? '' : String(schema.name ?? '')
          if (name.length > 0) live.add(name)
        }
      } catch (error) {
        logger.warn(`读取工具清单失败，插件开关未生效：${String((error && error.message) || error)}`)
        return undefined
      }

      /** @type {string[]} */
      const deny = []
      /** @type {string[]} */
      const missing = []
      for (const name of gate.deny) {
        if (name === RUN_CODE_NAME) continue
        if (live.has(name)) deny.push(name)
        else missing.push(name)
      }

      if (missing.length > 0) logger.info(`插件开关：${missing.join('、')} 现在没有注册，跳过`)
      if (deny.length === 0) {
        logger.info(`插件开关：${gate.deny.join('、')} 目前没有可隐藏的工具，无需隐藏`)
        return undefined
      }

      let dispose
      try {
        dispose = tools.restrict({ deny })
      } catch (error) {
        logger.warn(`隐藏插件工具失败：${String((error && error.message) || error)}`)
        return undefined
      }

      logger.info(`插件开关：已隐藏 ${deny.length} 个工具（${deny.join('、')}）`)
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    }, 'agent-team-roles: tool gate')
  })
}
