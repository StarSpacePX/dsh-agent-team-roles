/**
 * dsh-agent-team-roles — host half / `/command` 调度（§5.39）。
 *
 * §5.39 的批量动作不是同一套规则的第二个实现，而是同一套规则作用在一张 map 上 ——
 * 所以这里只做调度：把动作名分给角色类或开关类的处理表。`await ensureTemplate(DEFAULT_MODE)`
 * 保留在分派**之前**（连未知动作也要先把标准模式读进内存），所以错误顺序是固定的。
 *
 * @module dsh-agent-team-roles/host/commands
 */
import { DEFAULT_MODE } from '../template.js'
import { roleHandlers } from './commands-role.js'
import { switchHandlers } from './commands-switches.js'

/**
 * @param {object} c - `{ h, modes, lifecycle, patches, state, team }`.
 * @returns {{ mutate: (service: object, body: object) => Promise<object> }}
 */
export function createCommands(c) {
  const { modes } = c
  const handlers = { ...roleHandlers(c), ...switchHandlers(c) }

  /**
   * @param {object} service - the `agentPresets` service.
   * @param {object} body
   * @returns {Promise<object>}
   */
  const mutate = async (service, body) => {
    const action = String(body.action ?? '')
    await modes.ensureTemplate(DEFAULT_MODE)

    const handler = handlers[action]
    if (handler === undefined) throw new Error(`未知操作：${action || '(空)'}`)
    return handler(service, body, action)
  }

  return { mutate }
}
