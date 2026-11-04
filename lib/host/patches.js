/**
 * 开关补丁：单个开关（set-override / set-mcp / 工具开关）与批量开关（set-switches）
 * 走同一批函数。批量不是同一套规则的第二个实现，而是同一套规则作用在一张 map 上，
 * 所以两者永远不会漂移。
 *
 * @module dsh-agent-team-roles/host/patches
 */
import { normalizeCapabilities } from '../deployment.js'

/** 唯一知道「一行的覆盖怎么写」的地方：单个动作与批量动作都经过这里。
 * 补丁是 `{ disabled, config, clearConfig }`，为 undefined 的键表示不改。 */
export function patchOverrides(overrides, rowId, patch) {
  const next = { ...overrides }
  const entry = { ...(next[rowId] ?? {}) }

  if (typeof patch.disabled === 'boolean') entry.disabled = patch.disabled
  else if (patch.disabled === null) delete entry.disabled

  if (patch.config !== null && typeof patch.config === 'object' && !Array.isArray(patch.config)) {
    entry.config = { ...(entry.config ?? {}), ...patch.config }
  }

// clearConfig 把不再想覆盖的键整个删掉，让模板值回来；它与 config 里写 null 是两件事
// null 表示「从最终 config 里去掉这个键」。
  if (Array.isArray(patch.clearConfig) && entry.config !== undefined) {
    for (const key of patch.clearConfig) {
      if (typeof key === 'string') delete entry.config[key]
    }
    if (Object.keys(entry.config).length === 0) delete entry.config
  }

  if (entry.disabled === undefined && entry.config === undefined) delete next[rowId]
  else next[rowId] = entry
  return next
}

/** MCP 的同一套规则：一个开关就是 deny 成员关系，批量动作对每个服务器调它一次。
 * @param {object} capabilities @param {string} serverName @param {boolean} enabled */
export function patchMcpDeny(capabilities, serverName, enabled) {
  const next = normalizeCapabilities(capabilities)
  const deny = new Set(next.mcp.deny)
  if (enabled) deny.delete(serverName)
  else deny.add(serverName)
  next.mcp.deny = [...deny].sort()
  return next
}

/** 插件工具的同一套规则：一个开关就是精确工具名的 deny 成员关系。
 * @param {object} capabilities @param {string} toolName @param {boolean} enabled */
export function patchToolDeny(capabilities, toolName, enabled) {
  const next = normalizeCapabilities(capabilities)
  const deny = new Set(next.toolGate.deny)
  if (enabled) deny.delete(toolName)
  else deny.add(toolName)
  next.toolGate.deny = [...deny].sort()
  return next
}

/** 只认普通对象，其余一律当空对象：批量动作收的是 map，不能被数组或字符串骗过去。 */
export const switchMap = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
