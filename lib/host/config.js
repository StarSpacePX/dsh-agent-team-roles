/**
 * 宿主侧纯函数：插件配置归一化、来自界面的 mode / id 校验、网关配置解析，
 * 以及把「一个成员」认回「一个角色」的几种读法。
 *
 * 这些函数被读路径、写路径、成员绑定三处共用，且不依赖运行期状态，所以单独成文件。
 *
 * @module dsh-agent-team-roles/host/config
 */
import { defaultDir } from '../store.js'
import { DEFAULT_MODE, MODES } from '../template.js'
import { dshHome } from '../deployment.js'

/** MCP 桥接受的服务器名格式：严格校验，拼错立刻报出来。 */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** @param {object} config 插件自身配置行
 * @returns {{ dir: string, prefix: string, bindMembers: boolean, home: string }} */
export function normalizeConfig(config) {
  const raw = config && typeof config === 'object' ? config : {}
  const dir = typeof raw.dir === 'string' && raw.dir.trim().length > 0 ? raw.dir.trim() : defaultDir()
  const prefix =
    typeof raw.prefix === 'string' && raw.prefix.length > 0 ? raw.prefix : 'team-'

/** 部署文件（连接器存储、profile 补丁）所在目录：默认 $DSH_HOME，可覆盖以便测试指向夹具。 */
  const home = typeof raw.home === 'string' && raw.home.trim().length > 0 ? raw.home.trim() : dshHome()

  return { dir, prefix, bindMembers: raw.bindMembers === true, home }
}

/** 校验来自界面的 mode：未知值直接拒绝，不能像读盘那样悄悄回落 standard，
 * 否则一个拼错也会显示成功。
 * @param {unknown} value @returns {string | null} */
export function requireMode(value, known) {
  const ids = Array.isArray(known) && known.length > 0 ? known : MODES.map((mode) => mode.id)
  if (value === undefined || value === null || String(value).trim().length === 0) return DEFAULT_MODE
  const id = String(value).trim()
  if (!ids.includes(id)) {
    throw new Error(`未知的模式：${id}（可选 ${ids.join(' / ')}）`)
  }
  return id
}

/** 读会当目录名用的 id：非字符串直接拒绝，不做 String() 强转，
 * 否则 JSON 里的数字会造出真目录名。
 * @param {unknown} value @returns {string | null} */
export function requireStringId(value, field) {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error(`${field} 必须是字符串，收到：${JSON.stringify(value ?? null)}`)
  }
  return value
}

/** 角色 preset 以网关方式挂载本插件时的配置；不是网关挂载则 null。
 * 网关实例只负责隐藏工具，绝不碰角色存储（两个实例共写 roles.json 会重复注册 preset）。
 * @param {object | undefined} apply @returns {{ mcpGate?: string[], toolGate?: string[] } | null} */
export function gateConfig(config) {
  const raw = config && typeof config === 'object' ? config : {}

/** @param {unknown} source 一个网关块（mcpGate / toolGate）
 * @returns {string[] | null} deny 清单；块不存在返回 null */
  const denyList = (source) => {
    if (source === null || typeof source !== 'object' || Array.isArray(source)) return null
    const out = []
    const deny = /** @type {{ deny?: unknown }} */ (source).deny
    if (Array.isArray(deny)) {
      for (const value of deny) {
        const name = String(value ?? '').trim()
        if (name.length > 0 && !out.includes(name)) out.push(name)
      }
    }
    return out
  }

  const mcp = denyList(raw.mcpGate)
  const toolGate = denyList(raw.toolGate)
  if (mcp === null && toolGate === null) return null
  return { mcp, toolGate }
}

/** 成员绑定是否打开：插件配置（需重启）与文档设置（界面随时可改）两个来源取或。
 * @param {{ bindMembers: boolean }} options @param {object} doc @returns {boolean} */
export function bindingEnabled(options, settings) {
  return options.bindMembers === true || settings.bindMembers === true
}

/** 读子代理创建时带的委派标签：descriptor 事件先于 agents.create() 落地，
 * 所以 agent/created 触发时已经能读到。 */
export function delegationLabel(session) {
  if (session === null || typeof session !== 'object') return undefined
  if (typeof session.ownEvents !== 'function') return undefined
  const events = session.ownEvents()
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event === null || typeof event !== 'object' || event.type !== 'subagent/descriptor') continue
    const label = event.data === undefined ? undefined : event.data.label
    return typeof label === 'string' && label.trim().length > 0 ? label.trim() : undefined
  }
  return undefined
}

/** 按委派标签找角色：成员名就是角色名，preset id 去掉前缀也算别名。
 * @param {object[]} roles @param {string} label @returns {object | null} */
export function roleForLabel(roles, label, prefix) {
  const wanted = String(label ?? '').trim().toLowerCase()
  if (wanted.length === 0) return undefined
  return roles.find((role) => {
    if (role === null || typeof role !== 'object' || role.invalid === true) return false
    if (String(role.name ?? '').trim().toLowerCase() === wanted) return true
    const id = String(role.id ?? '')
    return id.startsWith(prefix) && id.slice(prefix.length).toLowerCase() === wanted
  })
}

/** 运行时为该 agent 记录的 Team 成员名，角色绑定里确定性的那半边。
 * @param {object} ctx @param {object} agent @returns {string | null} */
export function memberNameOf(ctx, agent) {
  try {
    if (ctx === null || ctx === undefined || typeof ctx.get !== 'function') return undefined
    const teams = ctx.get('agentTeams')
    if (teams === undefined || teams === null || typeof teams.tryMembership !== 'function') return undefined
    const membership = teams.tryMembership(agent)
    if (membership === null || typeof membership !== 'object') return undefined
    const name = membership.name
    return typeof name === 'string' && name.trim().length > 0 ? name.trim() : undefined
  } catch {
    return undefined
  }
}

/** 仍在创建中的子代理的 Team 名：创建窗口内 tryMembership 还不认它，
 * 只能提前从 Lead 的成员名单读。
 * @param {object} ctx @param {object} agent @returns {string | null} */
export function pendingMemberName(ctx, lead, childId) {
  try {
    if (ctx === null || ctx === undefined || typeof ctx.get !== 'function') return undefined
    const teams = ctx.get('agentTeams')
    if (teams === undefined || teams === null || typeof teams.listMembers !== 'function') return undefined
    const rows = teams.listMembers(lead)
    if (!Array.isArray(rows)) return undefined
    const row = rows.find(
      (candidate) =>
        candidate !== null && typeof candidate === 'object' && String(candidate.id) === String(childId),
    )
    const name = row === undefined ? undefined : row.name
    return typeof name === 'string' && name.trim().length > 0 ? name.trim() : undefined
  } catch {
    return undefined
  }
}
