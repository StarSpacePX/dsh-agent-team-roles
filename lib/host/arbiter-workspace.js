/**
 * 监察员工作区的排除判定：同一会话只许一套名册，会话 cwd 落在监察员工作区里时，
 * 名册、@成员 派活与回报骨架一条都不装。
 *
 * 判据是会话 cwd 与 dsh-arbiter 工作区目录比对；服务缺席（没装 dsh-arbiter）时仍用默认
 * 工作区兜底，保证两边永远不撞；用户改过工作区则以服务保存的值为准。
 *
 * @module dsh-agent-team-roles/host/arbiter-workspace
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** dsh-arbiter 的默认工作区目录名。 */
export function defaultArbiterDir() {
  return join(homedir(), 'Desktop', 'dsh-arbiter')
}

/** 路径归一：斜杠统一、去尾斜杠、小写；盘符根保留斜杠（c:/）。
 * @param {unknown} dir @returns {string} 归一后的路径，非字符串或空串返回 '' */
export function normalizeDir(dir) {
  if (typeof dir !== 'string') return ''
  let value = dir.trim()
  if (value === '') return ''
  value = value.replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^[A-Za-z]:$/.test(value)) value = `${value}/`
  return value.toLowerCase()
}

/** dir 是否就是 root 或位于其下（按路径段对齐）。
 * @param {unknown} dir @param {unknown} root @returns {boolean} */
export function isInsideDir(dir, root) {
  const child = normalizeDir(dir)
  const parent = normalizeDir(root)
  if (child === '' || parent === '') return false
  if (child === parent) return true
  return child.startsWith(parent.endsWith('/') ? parent : `${parent}/`)
}

/** 会话 cwd（SessionHeader.cwd）。
 * @param {object} agent @returns {string} */
export function sessionCwd(agent) {
  const cwd = agent !== null && typeof agent === 'object' ? agent.session?.header?.cwd : undefined
  return typeof cwd === 'string' ? cwd : ''
}

/** 从 cordis 服务读工作区目录：ctx.get('arbiterWorkspace')?.dir()，同步无副作用。
 * @param {object} ctx @returns {string | null} */
export function workspaceDirOf(ctx) {
  try {
    const service = ctx?.get?.('arbiterWorkspace') ?? null
    const dir = typeof service?.dir === 'function' ? service.dir() : null
    return typeof dir === 'string' && dir.trim() !== '' ? dir : null
  } catch {
    return null
  }
}

/** 建一个「监察员工作区排除」判定器：dirOf 现取服务值，缺席时只剩默认工作区兜底。
 * @param {object} [options] @param {() => (string | null)} [options.dirOf]
 * @param {string} [options.defaultDir]
 * @returns {{ excludedDirs: () => string[], isArbiterSession: (agent: object) => boolean }} */
export function createArbiterWorkspace({ dirOf = () => null, defaultDir = defaultArbiterDir() } = {}) {
  return {
/** 参与排除的目录：服务给的工作区加默认工作区兜底。 */
    excludedDirs() {
      const dirs = [defaultDir, typeof dirOf === 'function' ? dirOf() : null].map(normalizeDir).filter((dir) => dir !== '')
      return [...new Set(dirs)]
    },
/** 这条会话是否属于监察员工作区（是则不许装名册）。 */
    isArbiterSession(agent) {
      const cwd = sessionCwd(agent)
      if (cwd === '') return false
      return this.excludedDirs().some((root) => isInsideDir(cwd, root))
    },
  }
}
