/**
 * 部署侧只读读取：dsh home、MCP 连接器存储、部署快照，以及角色可携带的能力块校验。
 *
 * MCP 服务器和插件工具都不在 mode 的 preset 里，角色预设只能另外补一行网关行；
 * 这里只读、不写：连接器存储归 dsh-mcp-connector，profile 归部署自己的 pluginManager。
 */
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** dsh home 目录：DSH_HOME 优先，~/.dsh 只兜手工启动。
 * @param {Record<string, string | undefined>} [env]
 * @returns {string} */
export function dshHome(env = process.env) {
  return env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/** 拒绝 MCP 服务器时角色 preset 多出的网关行 id。 */
export const MCP_GATE_ID = 'agent-team-mcp-gate'

/** 拒绝插件工具时多出的网关行 id。
 * 与 MCP 网关行分开，两个维度各自独立开关，挂载时只做一次键判断。 */
export const TOOL_GATE_ID = 'agent-team-tool-gate'

/** 指令文件行：复用 standard preset 已有的 agent-instructions，只改 dshHome 指向角色目录。 */
export const INSTRUCTION_ROW_ID = 'agent-instructions'

/** 本插件包名：网关行会把插件再挂一次。 */
export const GATE_PLUGIN_NAME = 'dsh-agent-team-roles'

/** 打开 agent-team 运行时的 bundle：向部署的 pluginManager 选装，不自己改 profile 文件。 */
export const TEAM_BUNDLE = '@deepseek-ai/dsh-experimental-agent-team-profile'

/** 连接器存储表，相对 dsh home。 */
export const MCP_STORAGE = path.join('storages', 'mcp_connector.json')

/** 生成的 loop 快照文件名。 */
export const DEPLOYMENT_URL = new URL('./template/deployment.json', import.meta.url)

/** @param {string} [home] @returns {string} MCP 连接器存储文件绝对路径。 */
export function mcpStoragePath(home = dshHome()) {
  return path.join(home, MCP_STORAGE)
}

/** 把连接器存储解析成面板要的服务器列表；enabled 是部署级开关，只读展示、本插件不写。 */
export function parseMcpServers(text) {
  const document = JSON.parse(String(text).replace(/^\uFEFF/, ''))
  const connections = document?.tables?.connections
  if (connections === null || typeof connections !== 'object') return []

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

/** 读连接器存储；文件不存在不是错误，等于这个部署没有 MCP 服务器。 */
export async function readMcpServers(home = dshHome()) {
  const file = mcpStoragePath(home)
  try {
    return { file, servers: parseMcpServers(await readFile(file, 'utf8')), error: null }
  } catch (error) {
    const code = error === null || typeof error !== 'object' ? undefined : error.code
    return { file, servers: [], error: code === 'ENOENT' ? null : String((error && error.message) || error) }
  }
}

/** MCP 服务器工具名的公共前缀。 */
export const MCP_TOOL_PREFIX = 'mcp__'

export function mcpToolPrefix(serverName) {
  return `${MCP_TOOL_PREFIX}${serverName}__`
}

/** 该服务器当前活跃的公开工具名：tools.restrict() 拒绝未知名字，只能按实时清单过滤。 */
export function mcpToolNames(names, serverName) {
  const prefix = mcpToolPrefix(serverName)
  const out = []
  for (const name of names) {
    if (typeof name === 'string' && name.startsWith(prefix)) out.push(name)
  }
  return out
}

/** 角色的 MCP 网关行；config 用 mcpGate 字段，便于 apply 区分网关挂载与部署级挂载。 */
export function buildMcpGateRow(denied) {
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

/** 工具名格式：拼错的 deny 条目在挂载时什么都不匹配，等于静默失效。 */
export const TOOL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/

/** PTC 执行器保留名：tools.restrict() 拒绝 deny 它，绝不能进 deny 清单。 */
export const RUN_CODE_NAME = 'run_code'

/** 角色的插件工具网关行；config 用 toolGate 字段，存精确工具名（没有前缀可推导）。 */
export function buildToolGateRow(denied) {
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

/** 解析生成的部署快照。 */
export function parseDeployment(text) {
  const document = JSON.parse(String(text).replace(/^\uFEFF/, ''))
  if (document === null || typeof document !== 'object') return { source: {}, loop: null }
  const loop = document.loop === null || typeof document.loop !== 'object' ? null : document.loop
  return { source: document.source ?? {}, loop }
}

let deploymentPromise = null

/** 每进程只读一次快照；快照缺失按空文档处理，由界面提示，不报错。 */
export function loadDeployment() {
  if (deploymentPromise === null) {
    deploymentPromise = readFile(DEPLOYMENT_URL, 'utf8').then(
      (text) => parseDeployment(text),
      () => ({ source: {}, loop: null }),
    )
  }
  return deploymentPromise
}

/** 角色可携带的能力块（已归一化）。 */
export function defaultCapabilities() {
  return {
    mcp: { deny: /** @type {string[]} */ ([]) },
    toolGate: { deny: /** @type {string[]} */ ([]) },
  }
}

/** 校验并归一化能力块；未知键直接丢弃，否则旧版本残留键会一直回写。 */
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

// 插件工具块也丢 run_code：手改角色文件带上它，会让该角色每次挂载都抛错。
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
