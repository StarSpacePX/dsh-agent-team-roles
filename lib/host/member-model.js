/** 把角色的模型/推理强度装到刚建出来的成员 agent 上。
 *
 * 不能靠预设里加行：`@deepseek-ai/dsh-agent-default-model` 注册的是单例服务
 * `agentDefaultModel`，部署顶层已有一行，预设里再加一行会互抢服务、整个预设挂载失败。
 *
 * 也不能走 `sessionController.selectModel()`：它在装完之后还会
 * `agentDefaultModel.saveSelection()`，把角色的模型写成整个部署的默认值。
 * 只调 agent 作用域的 `selectForNextRequest`，选择落在这一条会话的日志里，
 * 全局默认不动。
 *
 * 时机：必须在成员第一轮请求之前。`agent/created` 早于任何请求，够用。
 *
 * @module dsh-agent-team-roles/host/member-model
 */
import { normalizeModel } from '../storeRole.js'

/** 这条 role 是否要动成员的模型。空 = 跟随部署默认。 */
export function hasModel(role) {
  const model = normalizeModel(role?.model)
  return model.provider.length > 0 && model.model.length > 0
}

/** 校验并安装一次 agent 作用域的模型选择；失败只 warn，不打断成员创建。
 * @param {object} h @param {object} agent @param {object} role @returns {Promise<boolean>} */
export async function applyMemberModel(h, agent, role) {
  if (!hasModel(role)) return false
  const model = normalizeModel(role.model)

  const controller = h.ctx?.get?.('sessionController') ?? null
  const installer = controller?.agents
  if (installer === undefined || typeof installer?.selectForNextRequest !== 'function') {
    h.logger.warn('这个部署没有 sessionController.agents，角色的模型设置没生效')
    return false
  }

  try {
    // 先让 llm 校验这组 provider/model/effort：不支持的档位在这里就拒，别等到请求时。
    const resolved = await h.ctx.llm?.resolveCallConfig?.({
      provider: model.provider,
      model: model.model,
      ...(model.reasoningEffort.length === 0 ? {} : { reasoningEffort: model.reasoningEffort }),
    })
    const selection = {
      provider: resolved?.provider ?? model.provider,
      model: resolved?.model ?? model.model,
      ...(resolved?.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort }),
    }
    installer.selectForNextRequest(agent, selection)
    h.logger.info(`成员 ${String(agent?.session?.id ?? '')} 的模型按角色设为 ${selection.provider}/${selection.model}`)
    return true
  } catch (error) {
    h.logger.warn(`角色 ${String(role?.id ?? '')} 的模型没能装到成员上：${String((error && error.message) || error)}`)
    return false
  }
}
