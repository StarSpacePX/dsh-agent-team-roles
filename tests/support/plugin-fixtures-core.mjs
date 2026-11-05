/** 领域夹具：角色定义、假 teammate、假 loader、名册与任务事件……假环境本身在 ../harness.mjs。 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { TEAM_BUNDLE } from '../../lib/deployment.js'
import { createHarness, call } from './harness.mjs'
import os from 'node:os'
import path from 'node:path'

export const STATE_URL = '/api/dsh-agent-team-roles/state'
export const COMMAND_URL = '/api/dsh-agent-team-roles/command'

/** 平台门的期望值表：shipped 模板里 tool-bash 只在 Windows 上禁用。断言用这张表而非实现表达式
 * 把实现表达式抄进断言（自证式）；表里没有的平台直接报错，不退回默认值。 */
export const BASH_DISABLED_ON = { win32: true, darwin: false, linux: false }

/** @param {string} [platform] @returns {boolean} 该平台上 `tool-bash` 是否禁用。 */
export function expectedBashDisabled(platform = process.platform) {
  if (!Object.prototype.hasOwnProperty.call(BASH_DISABLED_ON, platform)) {
    throw new Error(`未知平台 ${platform}：先把期望值补进 BASH_DISABLED_ON 再跑这条断言`)
  }
  return BASH_DISABLED_ON[platform]
}

/** 写路径把重建排到回包之后（REBUILD_DELAY_MS = 200 的去抖计时器），所以「写完要看到新定义」的断言都得等这次后台重建落定。 */
export const REBUILD_WAIT_MS = 400
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))