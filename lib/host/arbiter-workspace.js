/**
 * dsh-agent-team-roles — host half / 监察员工作区排除判定。
 *
 * 用户 m03336：「teams 原插件，默认排除 dsh-arbiter 的默认工作区，防止冲突」。
 * 同一条会话只许一套名册（需求 R12）：会话 cwd 落在监察员工作区里时，原件整条跳过
 * 名册、`@成员` 派活与回报骨架，一条都不装。
 *
 * 判据与副本插件同源：会话 cwd 比对 dsh-arbiter 的工作区目录。区别是原件**多一条兜底**
 * ——服务缺席（dsh-arbiter 没装）时仍把 `<homedir>\Desktop\dsh-arbiter` 当作排除目录，
 * 保证两边永远不撞；用户改过工作区时以服务给的值（保存的 `workspacePath`）为准。
 *
 * 工作区从 cordis 服务 `arbiterWorkspace` 同步读（dsh-arbiter `ctx.provide` 的那个）：
 * 不读状态接口、不自调用 HTTP、不轮询（用户 m06602）。判断不了 cwd 时一律**不排除**
 * （照旧装名册）——保持改造前行为，不能因为读不到工作区把用户的名册弄没。
 *
 * @module dsh-agent-team-roles/host/arbiter-workspace
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** dsh-arbiter 的默认工作区目录（`DEFAULT_WORKSPACE_NAME = 'dsh-arbiter'`）。 */
export function defaultArbiterDir() {
  return join(homedir(), 'Desktop', 'dsh-arbiter')
}

/**
 * 路径归一：斜杠统一、去尾斜杠、小写。盘符根保留斜杠（`c:/`）。
 *
 * @param {unknown} dir
 * @returns {string} 归一后的路径；非字符串/空串返回 `''`。
 */
export function normalizeDir(dir) {
  if (typeof dir !== 'string') return ''
  let value = dir.trim()
  if (value === '') return ''
  value = value.replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^[A-Za-z]:$/.test(value)) value = `${value}/`
  return value.toLowerCase()
}

/**
 * `dir` 是否就是 `root`，或在 `root` 之下（路径段对齐）。
 *
 * @param {unknown} dir
 * @param {unknown} root
 * @returns {boolean}
 */
export function isInsideDir(dir, root) {
  const child = normalizeDir(dir)
  const parent = normalizeDir(root)
  if (child === '' || parent === '') return false
  if (child === parent) return true
  return child.startsWith(parent.endsWith('/') ? parent : `${parent}/`)
}

/**
 * 会话 cwd（`SessionHeader.cwd`，`dsh-session\lib\types\types.d.ts:69`）。
 *
 * @param {object} agent
 * @returns {string}
 */
export function sessionCwd(agent) {
  const cwd = agent !== null && typeof agent === 'object' ? agent.session?.header?.cwd : undefined
  return typeof cwd === 'string' ? cwd : ''
}

/**
 * 从 cordis 服务读出工作区目录：`ctx.get('arbiterWorkspace')?.dir()`。同步、无副作用。
 *
 * @param {object} ctx
 * @returns {string | null}
 */
export function workspaceDirOf(ctx) {
  try {
    const service = ctx?.get?.('arbiterWorkspace') ?? null
    const dir = typeof service?.dir === 'function' ? service.dir() : null
    return typeof dir === 'string' && dir.trim() !== '' ? dir : null
  } catch {
    return null
  }
}

/**
 * 建一个「监察员工作区排除」判定器：`dirOf()` 现取服务值，缺席时只剩默认工作区兜底。
 *
 * @param {object} [options]
 * @param {() => (string | null)} [options.dirOf]
 * @param {string} [options.defaultDir] dsh-arbiter 的默认工作区（兜底排除）
 * @returns {{ excludedDirs: () => string[], isArbiterSession: (agent: object) => boolean }}
 */
export function createArbiterWorkspace({ dirOf = () => null, defaultDir = defaultArbiterDir() } = {}) {
  return {
    /** 参与排除的目录：服务给的工作区 + 默认工作区兜底。 */
    excludedDirs() {
      const dirs = [defaultDir, typeof dirOf === 'function' ? dirOf() : null].map(normalizeDir).filter((dir) => dir !== '')
      return [...new Set(dirs)]
    },
    /** 这条会话是不是监察员工作区的会话（是则原件不许装名册）。 */
    isArbiterSession(agent) {
      const cwd = sessionCwd(agent)
      if (cwd === '') return false
      return this.excludedDirs().some((root) => isInsideDir(cwd, root))
    },
  }
}
