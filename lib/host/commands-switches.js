/**
 * /command 的开关与批量动作，改的是部署或文档级的开关，以及「一次手势、一个请求」的批量开关
 *
 * - reload / sync：显式让注册表与存储一致（reload 还会重读部署名册与组合清单）；
 * - export-notes：写出 notes.json；
 * - set-switches：「全开 / 全关」过去每行一个请求，每个都重同步所有角色预设；现在客户端把
 *   期望状态发一次，服务端应用一次、落盘一次、重建一次；
 * - set-team / set-chat-tab：团队运行时与群聊页签。
 *
 * @module dsh-agent-team-roles/host/commands-switches
 */
import { exportNotes } from '../notes.js'
import { TOOL_NAME_PATTERN, readMcpServers } from '../deployment.js'
import { adoptMigratedRoles } from './adopt.js'
import { SERVER_NAME_PATTERN } from './config.js'

/** @param {object} c `{ h, modes, lifecycle, patches, state, team }`
 * @returns {Record<string, (service: object, body: object, action: string) => Promise<object>>} */
export function switchHandlers(c) {
  const { h, modes, lifecycle, patches, state, team } = c

  return {
    reload: async (service, body, action) => {
      await h.store.load()
      await adoptMigratedRoles(h.store, h.options)
// 显式「重载」是唯一要求重读部署名册的动作（用户可能刚启用或禁用了别的 preset）。
      modes.invalidateRoster()
// 同一个「我不信缓存了」的意思也适用于组合包清单。
      team.invalidateTeam()
      const result = await lifecycle.sync(service)
      return { action, result, state: await state.replyState() }
    },

    sync: async (service, body, action) => {
      const result = await lifecycle.sync(service)
      return { action, result, state: await state.replyState() }
    },

// 写出 notes.json（默认值加文件里已有的键，已有优先）：点一次就能拿到一份列着所有键、
// 可以集中修改的文件，它落在 roles.json 旁边。
    'export-notes': async (service, body, action) => {
      const result = await exportNotes(h.options.dir)
      return { action, result, state: await state.replyState() }
    },

// set-switches：一次手势一个请求。
// body: `{ id, rows: { [rowId]: boolean }, mcp: { [server]: boolean }, tools: { [toolName]: boolean } }`；
// 没点名的保持当前值，所以连点会合并成同一个动作。
    'set-switches': async (service, body, action) => {
      const id = String(body.id ?? '')
      const role = h.store.find(id)
      if (role === undefined) throw new Error(`角色不存在：${id}`)

      const rows = patches.switchMap(body.rows)
      const mcp = patches.switchMap(body.mcp)
      const tools = patches.switchMap(body.tools)
      const rowIds = Object.keys(rows)
      const serverNames = Object.keys(mcp)
      const toolNames = Object.keys(tools)
      if (rowIds.length === 0 && serverNames.length === 0 && toolNames.length === 0) {
        throw new Error('set-switches 需要 rows、mcp 或 tools')
      }
      for (const rowId of rowIds) {
        if (typeof rows[rowId] !== 'boolean') throw new Error(`行开关必须是布尔值：${rowId}`)
      }
      for (const serverName of serverNames) {
        if (typeof mcp[serverName] !== 'boolean') {
          throw new Error(`server 开关必须是布尔值：${serverName}`)
        }
        if (!SERVER_NAME_PATTERN.test(serverName)) {
          throw new Error(`MCP server 名字不合法：${JSON.stringify(serverName)}`)
        }
      }
      for (const toolName of toolNames) {
        if (typeof tools[toolName] !== 'boolean') {
          throw new Error(`工具开关必须是布尔值：${toolName}`)
        }
        if (!TOOL_NAME_PATTERN.test(toolName)) {
          throw new Error(`工具名不合法：${JSON.stringify(toolName)}`)
        }
      }

// 与单服务器动作同样的拒绝规则，只是整批只读一次注册表。
      if (serverNames.length > 0) {
        const known = (await readMcpServers(h.options.home)).servers.map((server) => server.serverName)
        const unknown = serverNames.filter((name) => !known.includes(name))
        if (unknown.length > 0) {
          throw new Error(
            `部署里没有 MCP server「${unknown.join('、')}」${known.length > 0 ? `，现有：${known.join('、')}` : '（连接器里还没有任何连接）'}`,
          )
        }
      }

// 插件工具同理：applyToolGate 会与实时注册表取交集，没人注册的名字会让开关静默失效。
// 注册表读不出来不算拒绝——缺 tools 服务不能把面板变成只读。
      if (toolNames.length > 0) {
        const listing = state.readToolGate()
        if (listing.error === null) {
          const known = new Set(listing.tools.map((tool) => tool.name))
          const unknown = toolNames.filter((name) => !known.has(name))
          if (unknown.length > 0) {
            throw new Error(`这个部署里没有工具：${unknown.join('、')}`)
          }
        }
      }

      let overrides = role.overrides ?? {}
      for (const rowId of rowIds) overrides = patches.patchOverrides(overrides, rowId, { disabled: rows[rowId] })

      const next = { ...role, overrides }
      if (serverNames.length > 0 || toolNames.length > 0) {
        let capabilities = role.capabilities
        for (const serverName of serverNames) {
          capabilities = patches.patchMcpDeny(capabilities, serverName, mcp[serverName])
        }
        for (const toolName of toolNames) {
          capabilities = patches.patchToolDeny(capabilities, toolName, tools[toolName])
        }
        next.capabilities = capabilities
      }

      await h.store.upsert(next)
// 一次写、一次重建，这就是这个动作的全部意义。
      const result = await lifecycle.commit(service)
      return {
        action,
        id,
        rows: rowIds,
        mcp: serverNames,
        tools: toolNames,
        result,
        state: await state.replyState(),
      }
    },

// 没有 set-loop 了：角色不能带 agent-loop 行，agent 工厂槽位只有一个且被部署占着，
// 在预设里再挂一个会让整个预设挂载失败。面板只显示只读提示，客户端不会提交到这里。

    'set-bind-members': async (service, body, action) => {
      if (typeof body.enabled !== 'boolean') throw new Error('set-bind-members 需要 enabled 布尔值')
      await h.store.setSetting('bindMembers', body.enabled)
      return { action, enabled: body.enabled, state: await state.replyState() }
    },

// 「启用智能体团队」只有一个语义：团队运行时开不开。开 = 选上团队组合包并打开成员绑定；关 = 都关。
// 选择权在部署，所以这里调 pluginManager，结果原样回传（含「需要重启」）。
    'set-team': async (service, body, action) => {
      if (typeof body.enabled !== 'boolean') throw new Error('set-team 需要 enabled 布尔值')
      const result = await team.setTeam(body.enabled)
      return { action, enabled: body.enabled, result, state: await state.replyState() }
    },

// 显示或隐藏「群聊」页签：客户端立即挂载或释放它的注册，不需要重启也不需要刷新页面。
    'set-hide-chat-tab': async (service, body, action) => {
      if (typeof body.enabled !== 'boolean') throw new Error('set-hide-chat-tab 需要 enabled 布尔值')
      await h.store.setSetting('hideChatTab', body.enabled)
      return { action, enabled: body.enabled, state: await state.replyState() }
    },
  }
}
