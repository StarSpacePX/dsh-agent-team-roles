/**
 * The one capability row a role needs but the shipped `standard` preset does not
 * carry: the deployment's MCP servers.
 *
 * MCP servers live outside the preset tree — they are loader entries created by
 * `dsh-mcp-connector` — so a role preset, composed from the mode's preset
 * alone, cannot see them. That is the §5.9 gap; the user's directive of
 * 2026-09-27 ("mcp 加开关，loop 加路径选择以及可以复制标准模式") is the
 * authorization to close it, and this module is the read-only half of that: it
 * never writes to the connector's storage.
 *
 * MCP is read *at runtime* from `<DSH_HOME>/storages/mcp_connector.json`. The
 * connector owns that file, adds and removes connections through its own UI, and
 * a role switch has to follow those edits without a regeneration step. The file
 * is plain JSON.
 *
 * An MCP switch is a **visibility filter**: the role's preset gets one gateway
 * row that calls `tools.restrict({ deny })` with the exact public names of the
 * switched-off servers, so "关" means the agent cannot see that server's tools
 * even though the deployment still runs it. Declaring a second
 * `@deepseek-ai/dsh-mcp-client` instance inside the role would instead give the
 * role its *own* connection (allowed — mcp-client reserves `serverName` per
 * scope — but it spawns a second server process per agent and leaves the
 * switched-off case still inheriting the global tools).
 *
 * ## Why there is no loop row here (§5.30)
 *
 * The other half of that directive — "loop 加路径选择" — cannot work here:
 * a role that switched such a row on failed to mount and silently vanished
 * from the preset picker. Two walls, in order:
 *
 *  1. `agent-loop` registers the *global* `agentLoop` service, and a preset may
 *     only carry services that live in an isolate realm
 *     (`dsh-agent-preset-registry/lib/types/mount.js:241`). Wrapping the row in
 *     a `cordis:group` with `isolate: { agentLoop: true }` got past this — the
 *     error changed, which is how the second wall surfaced.
 *  2. `@deepseek-ai/dsh-agent` allows exactly **one** agent factory per process
 *     (`setFactory` throws `an agent factory is already registered`,
 *     `dsh-agent/lib/types/index.js:427-433`) and `agent-loop` claims it at
 *     construction. No isolation can create a second slot.
 *
 * Even if it could mount, the loop row could not do what the panel promised:
 * the working directory of a task is `SessionHeader.cwd`, fixed when the session
 * is created (`dsh-api-session-controller/lib/index.js:253`, and a mismatch is
 * rejected at `:272-273`), and `AgentOptions` carries no `cwd` at all — the
 * `agents` list in the loop's own config means "agents created or resumed at
 * plugin startup". `PresetDefinition` has no `cwd` field either. So the panel is
 * now a read-only 「角色工作目录」 note; see the README's loop section.
 *
 * @module dsh-agent-team-roles/deployment
 */
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * The dsh home directory. `DSH_HOME` wins because the deployment sets it
 * explicitly; the `~/.dsh` fallback only covers a hand-rolled launch.
 *
 * This lives here rather than in `store.js` so the dependency runs one way:
 * the store needs the home directory to locate its own file, while the
 * deployment readers need it to locate the connector storage.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function dshHome(env = process.env) {
  return env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/** Row id of the gateway row a role preset gains when MCP servers are denied. */
export const MCP_GATE_ID = 'agent-team-mcp-gate'

/**
 * Row id of the gateway row a role preset gains when plugin tools are denied
 * (§5.55).
 *
 * A second gateway row next to {@link MCP_GATE_ID} rather than a shared one, so
 * the two dimensions stay independently switchable and the mount-time dispatch
 * stays a plain key check. Both rows mount this same plugin; the row order
 * carries no meaning (see the base patch's own note on row ordering), so the
 * two can sit wherever the role's intent puts them.
 */
export const TOOL_GATE_ID = 'agent-team-tool-gate'

/**
 * Row id of the instruction-file row a role points at its own directory (§5.30).
 *
 * Unlike the MCP gate this is **not** a new row: the `standard` preset already
 * carries `agent-instructions`, and a role only overrides one key of its
 * config — `dshHome`. That keeps the change inside R3 ("只引用，不新增").
 */
export const INSTRUCTION_ROW_ID = 'agent-instructions'

/** The plugin's own package name — the gateway row mounts us a second time. */
export const GATE_PLUGIN_NAME = 'dsh-agent-team-roles'

/**
 * The bundle that turns the agent-team runtime on (§5.33).
 *
 * It is one of the bundles this dsh installation *supplies*: it is present in
 * the installation's own tree, selected or not, so turning the team on is a
 * profile selection rather than an install. The plugin never writes the profile
 * files itself — it asks the deployment's own `pluginManager` service, which is
 * the same path the GUI's plugin page and `dsh plugin` use.
 */
export const TEAM_BUNDLE = '@deepseek-ai/dsh-experimental-agent-team-profile'

/** The connector's storage table, relative to the dsh home. */
export const MCP_STORAGE = path.join('storages', 'mcp_connector.json')

/** The generated loop snapshot. */
export const DEPLOYMENT_URL = new URL('./template/deployment.json', import.meta.url)

/**
 * @param {string} [home]
 * @returns {string} absolute path of the MCP connector storage file.
 */
export function mcpStoragePath(home = dshHome()) {
  return path.join(home, MCP_STORAGE)
}

/**
 * Parse the connector's storage document into the server list the UI renders.
 *
 * Only the fields the panel needs are kept. `enabled` is the *deployment-level*
 * switch owned by the connector — it is shown for context and never written by
 * this plugin; a role's own switch is the visibility filter.
 *
 * @param {string} text - raw file contents.
 * @returns {{ key: string, serverName: string, label: string, transport: string | null, enabled: boolean, target: string | null }[]}
 * @throws {SyntaxError} when the file is not JSON.
 */
export function parseMcpServers(text) {
  const document = JSON.parse(String(text).replace(/^\uFEFF/, ''))
  const connections = document?.tables?.connections
  if (connections === null || typeof connections !== 'object') return []

  /** @type {object[]} */
  const servers = []
  for (const [entryKey, record] of Object.entries(connections)) {
    if (record === null || typeof record !== 'object') continue
    const serverName = String(record.serverName ?? '').trim()
    if (serverName.length === 0) continue
    servers.push({
      key: String(record.key ?? entryKey),
      serverName,
      label: String(record.name ?? '').trim() || serverName,
      transport: String(record.transport ?? '').trim() || null,
      enabled: record.enabled === true,
      target: String(record.command ?? record.url ?? '').trim() || null,
    })
  }

  return servers.sort((left, right) => left.serverName.localeCompare(right.serverName))
}

/**
 * Read the connector's storage file.
 *
 * A missing file is not an error: it means the connector has never been used, so
 * there are simply no MCP servers to switch.
 *
 * @param {string} [home]
 * @returns {Promise<{ file: string, servers: object[], error: string | null }>}
 */
export async function readMcpServers(home = dshHome()) {
  const file = mcpStoragePath(home)
  try {
    return { file, servers: parseMcpServers(await readFile(file, 'utf8')), error: null }
  } catch (error) {
    const code = error === null || typeof error !== 'object' ? undefined : error.code
    return { file, servers: [], error: code === 'ENOENT' ? null : String((error && error.message) || error) }
  }
}

/** The public prefix every tool of an MCP server carries. */
export const MCP_TOOL_PREFIX = 'mcp__'

/** @param {string} serverName @returns {string} the public prefix of that server's tools. */
export function mcpToolPrefix(serverName) {
  return `${MCP_TOOL_PREFIX}${serverName}__`
}

/**
 * The exact public tool names one MCP server owns.
 *
 * `tools.restrict()` rejects unknown names, so the caller must filter a *live*
 * listing rather than guess: this is why the gateway resolves its deny list at
 * mount time instead of storing tool names.
 *
 * @param {Iterable<string>} names - live public tool names.
 * @param {string} serverName
 * @returns {string[]}
 */
export function mcpToolNames(names, serverName) {
  const prefix = mcpToolPrefix(serverName)
  /** @type {string[]} */
  const out = []
  for (const name of names) {
    if (typeof name === 'string' && name.startsWith(prefix)) out.push(name)
  }
  return out
}

/**
 * The gateway row for a role, or `null` when nothing is denied.
 *
 * The config field is `mcpGate` (not `deny`) so the plugin's `apply()` can tell
 * a gateway mount from its normal deployment-level mount at a glance.
 *
 * @param {Iterable<string>} denied - server names.
 * @returns {object | null}
 */
export function buildMcpGateRow(denied) {
  /** @type {string[]} */
  const servers = []
  for (const value of denied ?? []) {
    const serverName = String(value ?? '').trim()
    if (serverName.length > 0 && !servers.includes(serverName)) servers.push(serverName)
  }
  if (servers.length === 0) return null
  return {
    id: MCP_GATE_ID,
    name: GATE_PLUGIN_NAME,
    config: { mcpGate: { deny: servers.sort() } },
  }
}

/**
 * The tool-name shape the panel accepts, and the reservation it must respect.
 *
 * Every registered tool name in this deployment matches it; the point of
 * validating is the same as for MCP server names — a typo would become a deny
 * entry that matches nothing at mount time and silently does nothing.
 */
export const TOOL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/

/**
 * The reserved PTC executor name.
 *
 * `tools.restrict()` refuses to deny it (it is the one tool a `ptc` agent is
 * told to call), so it must never reach a deny list. Hard-coded rather than
 * imported: this plugin does not depend on `@deepseek-ai/dsh-tools`, it only
 * meets it through the service registry.
 */
export const RUN_CODE_NAME = 'run_code'

/**
 * The gateway row for a role's plugin-tool denials, or `null` when nothing is
 * denied (§5.55).
 *
 * The config field is `toolGate` — the sibling of `mcpGate` — so `apply()` can
 * tell the two gateway mounts, and a gateway mount from the deployment-level
 * mount, apart at a glance.
 *
 * Unlike the MCP gateway this one stores **exact tool names**, because there is
 * no prefix that identifies a plugin's tools: `tools.schemas()` reports a name
 * and a description, no owner. The names are resolved against the live registry
 * at mount time, which is what keeps a role mountable after a plugin that used
 * to register one of them is uninstalled.
 *
 * @param {Iterable<string>} denied - public tool names.
 * @returns {object | null}
 */
export function buildToolGateRow(denied) {
  /** @type {string[]} */
  const names = []
  for (const value of denied ?? []) {
    const name = String(value ?? '').trim()
    if (name.length === 0 || name === RUN_CODE_NAME) continue
    if (!names.includes(name)) names.push(name)
  }
  if (names.length === 0) return null
  return {
    id: TOOL_GATE_ID,
    name: GATE_PLUGIN_NAME,
    config: { toolGate: { deny: names.sort() } },
  }
}

/**
 * Parse the generated deployment snapshot.
 *
 * @param {string} text
 * @returns {{ source: object, loop: object | null }}
 */
export function parseDeployment(text) {
  const document = JSON.parse(String(text).replace(/^\uFEFF/, ''))
  if (document === null || typeof document !== 'object') return { source: {}, loop: null }
  const loop = document.loop === null || typeof document.loop !== 'object' ? null : document.loop
  return { source: document.source ?? {}, loop }
}

/** @type {Promise<{ source: object, loop: object | null }> | null} */
let deploymentPromise = null

/**
 * Read the bundled deployment snapshot once per process.
 *
 * A missing snapshot (a plugin installed without running the tool) is an empty
 * document rather than a failure: `loop` simply has no "standard mode" to copy,
 * which the UI reports instead of hiding the panel.
 *
 * @returns {Promise<{ source: object, loop: object | null }>}
 */
export function loadDeployment() {
  if (deploymentPromise === null) {
    deploymentPromise = readFile(DEPLOYMENT_URL, 'utf8').then(
      (text) => parseDeployment(text),
      () => ({ source: {}, loop: null }),
    )
  }
  return deploymentPromise
}

/** The capability blocks a stored role may carry, in normalized form. */
export function defaultCapabilities() {
  return {
    mcp: { deny: /** @type {string[]} */ ([]) },
    toolGate: { deny: /** @type {string[]} */ ([]) },
  }
}

/**
 * Validate the capability blocks arriving from disk or from the UI.
 *
 * Unknown keys are dropped rather than preserved: this runs on load as well as
 * on write, so a stray key would otherwise round-trip forever. That is also what
 * retires the `loop` block a role file from an older version still carries
 * (§5.30 — it described a row that can no longer be mounted).
 *
 * @param {unknown} input
 * @returns {{ mcp: { deny: string[] }, toolGate: { deny: string[] } }}
 */
export function normalizeCapabilities(input) {
  const out = defaultCapabilities()
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return out
  const raw = /** @type {Record<string, unknown>} */ (input)

  const mcp = raw.mcp
  if (mcp !== null && typeof mcp === 'object' && !Array.isArray(mcp)) {
    const deny = /** @type {Record<string, unknown>} */ (mcp).deny
    if (Array.isArray(deny)) {
      for (const value of deny) {
        const serverName = String(value ?? '').trim()
        if (serverName.length > 0 && !out.mcp.deny.includes(serverName)) out.mcp.deny.push(serverName)
      }
      out.mcp.deny.sort()
    }
  }

  // §5.55 — the plugin-tool block. Same shape, same rules; `run_code` is dropped
  // here as well as in `buildToolGateRow` so a hand-edited role file cannot
  // carry a name that would make every mount of that role throw.
  const toolGate = raw.toolGate
  if (toolGate !== null && typeof toolGate === 'object' && !Array.isArray(toolGate)) {
    const deny = /** @type {Record<string, unknown>} */ (toolGate).deny
    if (Array.isArray(deny)) {
      for (const value of deny) {
        const name = String(value ?? '').trim()
        if (name.length === 0 || name === RUN_CODE_NAME) continue
        if (!out.toolGate.deny.includes(name)) out.toolGate.deny.push(name)
      }
      out.toolGate.deny.sort()
    }
  }

  return out
}
