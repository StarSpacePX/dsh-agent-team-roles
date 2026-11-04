/**
 * dsh-agent-team-roles — host half / 开关补丁（§5.39、§5.55）。
 *
 * 单个开关（`set-override` / `set-mcp` / 工具开关）与批量开关（`set-switches`）走的是
 * **同一批函数**，所以两者永远不会漂移：批量不是同一套规则的第二个实现，而是同一套
 * 规则作用在一张 map 上。
 *
 * @module dsh-agent-team-roles/host/patches
 */
import { normalizeCapabilities } from '../deployment.js'

/**
 * §5.39 — the one place that knows how a row's override is written.
 *
 * Both the single-row action (`set-override`) and the batch action
 * (`set-switches`) come through here, so the two can never drift apart: the
 * batch is *not* a second implementation of the same rules, it is the same
 * rules applied to a map.
 *
 * A patch is `{ disabled, config, clearConfig }`; a key that is absent means
 * "leave it alone", and `disabled: null` means "drop that override again".
 *
 * @param {Record<string, object>} overrides
 * @param {string} rowId
 * @param {{ disabled?: boolean|null, config?: object|null, clearConfig?: string[] }} patch
 * @returns {Record<string, object>} a new overrides map
 */
export function patchOverrides(overrides, rowId, patch) {
  const next = { ...overrides }
  /** @type {{ disabled?: boolean, config?: object }} */
  const entry = { ...(next[rowId] ?? {}) }

  if (typeof patch.disabled === 'boolean') entry.disabled = patch.disabled
  else if (patch.disabled === null) delete entry.disabled

  if (patch.config !== null && typeof patch.config === 'object' && !Array.isArray(patch.config)) {
    entry.config = { ...(entry.config ?? {}), ...patch.config }
  }

  // `clearConfig` removes keys the caller no longer wants overridden at all,
  // so the template value comes back. This is deliberately separate from a
  // `null` in `config`: `applyConfig` reads that `null` as "drop the key from
  // the effective config", which is a different (and still supported) intent.
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

/**
 * §5.39 — the same idea for MCP: one switch is `deny` membership, and the
 * batch action uses this exact function once per server.
 *
 * @param {object} capabilities
 * @param {string} serverName
 * @param {boolean} enabled
 */
export function patchMcpDeny(capabilities, serverName, enabled) {
  const next = normalizeCapabilities(capabilities)
  const deny = new Set(next.mcp.deny)
  if (enabled) deny.delete(serverName)
  else deny.add(serverName)
  next.mcp.deny = [...deny].sort()
  return next
}

/**
 * §5.55 — the same idea for the plugin tools: one switch is `deny` membership
 * of an exact tool name.
 *
 * @param {object} capabilities
 * @param {string} toolName
 * @param {boolean} enabled
 */
export function patchToolDeny(capabilities, toolName, enabled) {
  const next = normalizeCapabilities(capabilities)
  const deny = new Set(next.toolGate.deny)
  if (enabled) deny.delete(toolName)
  else deny.add(toolName)
  next.toolGate.deny = [...deny].sort()
  return next
}

/**
 * A plain `{ key: value }` object, or `{}` for anything else — the batch
 * action takes maps and must not be talked into reading an array or a string.
 */
export const switchMap = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
