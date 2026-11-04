/**
 * dsh-agent-team-roles — host half / `/command` 的开关与批次动作（§5.33、§5.34、§5.39）。
 *
 * 这一组动作改的是**部署或文档级**的开关，以及「一次手势、一个请求」的批量开关：
 *
 * - `reload` / `sync`：显式让注册表与存储一致（`reload` 还会重读部署名册与组合清单）；
 * - `export-notes`：写出 `notes.json`（§5.34）；
 * - `set-switches`：§5.39 —— 「全开 / 全关」过去是每行一个请求，而**每一个**都会重同步
 *   所有角色预设（19 个工具行 = 19 次重建，正是用户撞上的那两秒卡顿）。现在客户端把
 *   **期望状态发一次**，服务端应用一次、落盘一次、重建一次。
 * - `set-bind-members` / `set-team` / `set-hide-chat-tab`：三个单开关。
 *
 * @module dsh-agent-team-roles/host/commands-switches
 */
import { exportNotes } from '../notes.js'
import { TOOL_NAME_PATTERN, readMcpServers } from '../deployment.js'
import { adoptMigratedRoles } from './adopt.js'
import { SERVER_NAME_PATTERN } from './config.js'

/**
 * @param {object} c - `{ h, modes, lifecycle, patches, state, team }`.
 * @returns {Record<string, (service: object, body: object, action: string) => Promise<object>>}
 */
export function switchHandlers(c) {
  const { h, modes, lifecycle, patches, state, team } = c

  return {
    reload: async (service, body, action) => {
      await h.store.load()
      await adoptMigratedRoles(h.store, h.options)
      // 显式「重载」是唯一要求重读部署名册的动作（用户可能刚启用/禁用了别的 preset）。
      modes.invalidateRoster()
      // 同一个「我不信缓存了」的意思也适用于组合包清单（§5.54）。
      team.invalidateTeam()
      const result = await lifecycle.sync(service)
      return { action, result, state: await state.replyState() }
    },

    sync: async (service, body, action) => {
      const result = await lifecycle.sync(service)
      return { action, result, state: await state.replyState() }
    },

    // §5.34 — 写出 notes.json（默认值 + 文件里已有的键，已有的优先）。用户点一
    // 次就能拿到一份列着所有键、可以集中改的文件；这不是「配置行」，是本插件
    // 自己的数据文件，所以它落在 roles.json 旁边。
    'export-notes': async (service, body, action) => {
      const result = await exportNotes(h.options.dir)
      return { action, result, state: await state.replyState() }
    },

    // §5.39 — `set-switches`: one request per gesture, not one per row.
    //
    // Body: `{ id, rows: { [rowId]: boolean }, mcp: { [server]: boolean },
    //          tools: { [toolName]: boolean } }`.
    // Anything not named keeps its current value, so a burst of individual
    // clicks collapses into this same action.
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

      // The same refusal the single-server action makes, except the registry is
      // read **once** for the whole batch instead of once per name.
      if (serverNames.length > 0) {
        const known = (await readMcpServers(h.options.home)).servers.map((server) => server.serverName)
        const unknown = serverNames.filter((name) => !known.includes(name))
        if (unknown.length > 0) {
          throw new Error(
            `部署里没有 MCP server「${unknown.join('、')}」${known.length > 0 ? `，现有：${known.join('、')}` : '（连接器里还没有任何连接）'}`,
          )
        }
      }

      // §5.55 — the plugin tools get the same treatment, for the same reason:
      // `applyToolGate` intersects the stored names with the live registry, so a
      // name nothing registers would silently turn that switch into a no-op.
      // An unreadable registry (`error !== null`) is deliberately *not* a
      // refusal — a missing `tools` service must not make the panel read-only.
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

      /** @type {object} */
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
      // One write, one rebuild — that is the whole point of the action.
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

    // There is deliberately no `set-loop` any more (§5.30). A role cannot
    // carry an `agent-loop` row: the service name can be isolated, but the
    // agent *factory* slot is single and taken by the deployment, so mounting
    // one inside a preset fails the whole preset. The panel is now a read-only
    // note and the client never posts here.

    'set-bind-members': async (service, body, action) => {
      if (typeof body.enabled !== 'boolean') throw new Error('set-bind-members 需要 enabled 布尔值')
      await h.store.setSetting('bindMembers', body.enabled)
      return { action, enabled: body.enabled, state: await state.replyState() }
    },

    // §5.33 — 「启用智能体团队」的语义就是一个：团队运行时开不开。
    // 开 = 选上团队组合包 + 打开成员绑定；关 = 都关。真正的选择权在部署手里，
    // 所以这里调用的是 `pluginManager`，结果原样回传（含「需要重启」）。
    'set-team': async (service, body, action) => {
      if (typeof body.enabled !== 'boolean') throw new Error('set-team 需要 enabled 布尔值')
      const result = await team.setTeam(body.enabled)
      return { action, enabled: body.enabled, result, state: await state.replyState() }
    },

    // R6 — hide / show the 「群聊」 tab. The client half reacts immediately by
    // mounting or disposing its `conversation.view` registration, so this needs
    // no restart and no page reload (§5.26).
    'set-hide-chat-tab': async (service, body, action) => {
      if (typeof body.enabled !== 'boolean') throw new Error('set-hide-chat-tab 需要 enabled 布尔值')
      await h.store.setSetting('hideChatTab', body.enabled)
      return { action, enabled: body.enabled, state: await state.replyState() }
    },
  }
}
