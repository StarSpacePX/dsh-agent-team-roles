/**
 * 一个角色在磁盘上拥有的文件：不再是共享 roles.json 里的一条，而是一整个目录。
 *
 *   <dir>/<roleId>/role.json    角色自己的配置
 *   <dir>/<roleId>/AGENTS.md    角色自己的指令文件
 *
 * 这个目录就是接线：指令行的 dshHome 指过来，规则文件就对那个角色生效。
 *
 * @module dsh-agent-team-roles/roleFiles
 */
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { dshHome } from './deployment.js'

/** dsh 默认查找的指令文件名。 */
export const AGENTS_MD_FILE = 'AGENTS.md'

/** 角色自己的配置文件，在角色自己的目录里。 */
export const ROLE_FILE = 'role.json'

/** Windows 设备名：它们指设备而不是文件，不能当角色 id。 */
const RESERVED_IDS = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

/** 仍是一个普通路径段的角色 id 长度上限。 */
const MAX_ID_LENGTH = 64

/** 拒绝不能作为数据目录内单个路径段的角色 id。
 * 这是硬护栏：roleDir 是角色 id 变成路径的唯一位置，而调用方的 id 未必过过 normalizeRole。
 * @param {unknown} id @returns {string} @throws {Error} id 不是合法单段路径 */
export function assertRoleId(id) {
  const text = typeof id === 'string' ? id : ''
  const refuse = (why) => {
    throw new Error(`角色 id ${why}：${JSON.stringify(id ?? null)}`)
  }
  if (text.length === 0) refuse('不能为空')
  if (text !== text.trim()) refuse('首尾不能有空白')
  if (text === '.' || text === '..') refuse('不能是相对路径')
  if (/[\\/:*?"<>|]/.test(text)) refuse('不能包含路径分隔符或非法字符')
  if (path.isAbsolute(text)) refuse('不能是绝对路径')
  if (path.win32.isAbsolute(text)) refuse('不能是绝对路径')
  if (text.endsWith('.')) refuse('不能以点结尾')
  if (RESERVED_IDS.has(text.toLowerCase())) refuse('不能是设备保留名')
  if (text.length > MAX_ID_LENGTH) refuse(`长度不能超过 ${MAX_ID_LENGTH}`)
  return text
}

/** @param {string} dir 插件数据目录 @param {string} id 角色（preset）id
 * @returns {string} 角色目录 @throws {Error} id 不是合法单段路径 */
export function roleDir(dir, id) {
  return path.join(dir, assertRoleId(id))
}

/** @param {string} dir @param {string} id @returns {string} `<角色目录>/role.json` */
export function roleFile(dir, id) {
  return path.join(roleDir(dir, id), ROLE_FILE)
}

/** @param {string} dir @param {string} id @returns {string} `<角色目录>/AGENTS.md` */
export function agentsMdFile(dir, id) {
  return path.join(roleDir(dir, id), AGENTS_MD_FILE)
}

/** 新角色 AGENTS.md 的唯一复制源：用户全局的 $DSH_HOME/AGENTS.md，固定而非探测。
 * 项目链不需要复制：dsh 会从会话工作目录及其祖先现场发现 AGENTS.md / CLAUDE.md。 */
function agentsMdSource(options = {}) {
  const home = typeof options.home === 'string' && options.home.length > 0 ? options.home : dshHome()
  return path.join(home, AGENTS_MD_FILE)
}

/** 那个文件，存在且非空时才返回。
 * @param {{ home?: string }} [options] @returns {Promise<string | null>} */
export async function pickAgentsMdSource(options = {}) {
  const source = agentsMdSource(options)
  try {
    const info = await stat(source)
    if (info.isFile() && info.size > 0) return source
  } catch {
// 这台机器没有用户全局指令文件。
  }

  return null
}

/** 建角色目录并给它一份 AGENTS.md。
 * 找不到复制源也照样建：目录的意义是让用户只改这个角色的规则，空文件也是合法起点。
 * @param {object} options @returns {Promise<void>} */
export async function createAgentsMd({ dir, id, source = null }) {
  const target = agentsMdFile(dir, id)
  await mkdir(roleDir(dir, id), { recursive: true })

  if (typeof source === 'string' && source.length > 0) {
    await copyFile(source, target)
    return { file: target, source, copied: true }
  }

  await writeFile(target, `# ${id}\n\n这个角色自己的规则文件（AGENTS.md）。\n`, 'utf8')
  return { file: target, source: null, copied: false }
}

/** 删掉角色拥有的一切：开关与目录是同一件事，留着目录会留下一个看似已删、盘上还有文件的角色。
 * @param {string} dir 插件数据目录 @param {string} id
 * @returns {Promise<boolean>} 是否有目录可删 */
export async function removeRoleDir(dir, id) {
  const target = roleDir(dir, id)
  let existed = false
  try {
    existed = (await stat(target)).isDirectory()
  } catch {
    return false
  }
  await rm(target, { recursive: true, force: true })
  return existed
}
