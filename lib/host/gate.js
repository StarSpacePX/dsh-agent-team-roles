/**
 * 平台门：本插件被加载的第二种方式。
 *
 * 角色关掉 MCP 服务或插件工具时，它的预设里带一行网关（agent-team-mcp-gate /
 * agent-team-tool-gate），那一行会在子代理自己的组合里把本模块再挂一次，带着
 * config.mcpGate / config.toolGate。这个实例只做一件事：把指名的工具从本作用域继承的东西里
 * 藏起来，做完就返回，绝不碰角色仓库。MCP 按服务名前缀解析，插件工具按精确工具名解析。
 *
 * @module dsh-agent-team-roles/host/gate
 */
import { RUN_CODE_NAME, mcpToolNames } from '../deployment.js'

/** 为某个 agent 作用域挂 MCP 可见性门（本插件的第二次加载）。
 * @param {object} ctx @param {object} config 带 mcpGate 服务器名列表
 * @returns {Promise<void>} */
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

/** 为某个 agent 作用域挂插件工具可见性门：形状与 MCP 门相同，带 config.toolGate。
 * @param {object} ctx @param {object} config @returns {Promise<void>} */
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

      const deny = []
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
