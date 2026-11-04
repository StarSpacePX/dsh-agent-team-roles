/**
 * 领域夹具（施工批次 A–G 的测试共用）：角色定义、假 teammate、假 loader、名册与任务事件……
 *
 * 批次 F4：从 tests/plugin.test.mjs 顶部逐字搬来，只加 export 前缀；唯一的路径调整是
 * 夹具体里 `new URL('../lib/…')` 加深一层为 `'../../lib/…'`。假环境本身在 ../harness.mjs。
 *
 * @module dsh-agent-team-roles/tests/support/plugin-fixtures
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { TEAM_BUNDLE } from '../../lib/deployment.js'
import { createHarness, call } from './harness.mjs'
import os from 'node:os'
import path from 'node:path'


export const STATE_URL = '/api/dsh-agent-team-roles/state'
export const COMMAND_URL = '/api/dsh-agent-team-roles/command'
export const TEAM_LOG_URL = '/api/dsh-agent-team-roles/team-log'

/**
 * §7 F3 — 平台门的期望值。（自证式断言：`assert.equal(x, process.platform === 'win32')`
 * 把实现里的表达式原样抄进断言，两边同源，改错也一起漂。）
 *
 * 这里把「部署事实」写成表：shipped 模板里 `tool-bash` 只在 Windows 上禁用。
 * 断言用这张表，不再复用实现表达式；表里没有的平台会直接报错，而不是悄悄
 * 退回某个默认值。
 *
 * @type {Record<string, boolean>}
 */
export const BASH_DISABLED_ON = { win32: true, darwin: false, linux: false }

/** @param {string} [platform] @returns {boolean} 该平台上 `tool-bash` 是否禁用。 */
export function expectedBashDisabled(platform = process.platform) {
  if (!Object.prototype.hasOwnProperty.call(BASH_DISABLED_ON, platform)) {
    throw new Error(`未知平台 ${platform}：先把期望值补进 BASH_DISABLED_ON 再跑这条断言`)
  }
  return BASH_DISABLED_ON[platform]
}

/**
 * §5.54 — 写路径把重建排到回包之后（`REBUILD_DELAY_MS = 200` 的去抖计时器），
 * 所以任何「写完要看到新定义」的断言都得等这一次后台重建落定。
 */
export const REBUILD_WAIT_MS = 400
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))