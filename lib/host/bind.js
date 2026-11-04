/**
 * 成员绑定：创建窗口优先，宣告期兜底。
 *
 * 1. 创建窗口：agents.create / agents.resume 的 setup 回调里 select 这个角色，组合在任何
 *    agent/created 监听器跑之前就定下来——这是必须的，standard preset 自带常驻 tool-subagent 行，
 *    它的监听器会先给子上下文装东西。
 * 2. 宣告期：没走这两条创建路径的，在 agent/created 里补一次绑定。
 *
 * @module dsh-agent-team-roles/host/bind
 */
import { roleForMemberName } from '../roles.js'
import { bindingEnabled, delegationLabel, memberNameOf, pendingMemberName, roleForLabel } from './config.js'
import { adoptMigratedRoles } from './adopt.js'

/** @param {object} h 共享宿主状态 @param {object} c `{ lifecycle, team }` */
export function installBind(h, c) {
  const { lifecycle, team } = c

  h.ctx.inject(['agentPresets'], (scoped) => {
    h.presets = scoped.agentPresets
    const service = h.presets

    scoped.effect(
      () => {
        let stopped = false

/** 把角色绑到刚被委派出来的成员上。
 * 子代理默认继承父的 preset；打开 bindMembers 后由成员自己的 Team 名决定角色，
 * 没有 Team 名的普通子代理仍回落到 descriptor 标签。
 * @param {object} ctx @param {object} agent @returns {Promise<void>} */
        const off = scoped.on('agent/created', async (payload) => {
          if (!bindingEnabled(h.options, h.store.settings)) return
          const agent = payload === undefined || payload === null ? undefined : payload.agent
          if (agent === undefined || agent === null) return
          const session = agent.session
          const header = session === undefined || session === null ? undefined : session.header
          if (header === undefined || header === null || header.parentSession === undefined) return
          const delegated =
            header.origin === 'subagent' ||
            (typeof header.delegationDepth === 'number' && header.delegationDepth > 0)
          if (!delegated) return

          const label = delegationLabel(session)
// 成员的 Team 名优先：它是校验过且唯一的名字；label 只是 descriptor 的自由文本 description，
// 只按 label 匹配会漏。label 保留作没走创建窗口那条路的兜底。
          const memberName = memberNameOf(scoped, agent)
          const named =
            memberName === undefined ? undefined : roleForMemberName(h.store.roles, memberName, h.options.prefix)
          const role =
            named ??
            (label === undefined ? undefined : roleForLabel(h.store.roles, label, h.options.prefix))
          if (role === undefined) {
            return
          }

          const who = memberName === undefined ? label : memberName
// 创建窗口已绑过角色，这里只是没走 create/resume 的兜底；组合已是该角色就跳过，
// 避免重挂触发 INACTIVE_EFFECT 竞态。
          let composedNow = null
          try {
            composedNow = service.composedPreset?.(agent.ctx) ?? null
          } catch (error) {
            composedNow = `error:${String((error && error.message) || error)}`
          }
          if (composedNow === role.id) {
            h.logger.info(`成员 ${who} 的角色「${role.name}」已由创建窗口绑定，宣告期跳过重复绑定`)
            return
          }
          try {
// 兜底路径同样先按需挂载，否则 select 会 not-found。
            await lifecycle.ensureRegistered(service, role.id)
            const committed = await service.select(agent, role.id)
// 这条创建方式没走 create/resume，在这里补一次绑定。
            h.logger.info(
              `成员 ${who} 已绑定角色「${role.name}」（preset ${committed}，来源 ${named === undefined ? '描述' : '成员名'}）`,
            )
          } catch (error) {
            h.logger.warn(`成员 ${who} 绑定角色失败：${String((error && error.message) || error)}`)
          }
        })

        void (async () => {
          try {
            await h.store.load()
            if (stopped) return
            await adoptMigratedRoles(h.store, h.options)
            if (stopped) return
            await lifecycle.sync(service)
            h.logger.info(
              `agent team 角色已就绪：${h.registered.size} 个，数据目录 ${h.store.dir}，成员绑定${
                bindingEnabled(h.options, h.store.settings) ? '开' : '关'
              }`,
            )
// 趁没人等，先把要跨 Remote 读的部署组合清单读掉。
            team.warmTeamCache()
          } catch (error) {
            h.logger.error(`agent team 角色初始化失败：${String((error && error.message) || error)}`)
          }
        })()

        return async () => {
          stopped = true
// 必须在 registered.clear() 之前置位：还在飞行中的注册会在回来时检查它。
          h.disposed = true
          lifecycle.cancelRebuild()
          team.invalidateTeam()
          if (typeof off === 'function') off()
          h.presets = null
          const disposers = [...h.registered.values()]
          h.registered.clear()
          await Promise.allSettled(disposers.map((dispose) => dispose()))
        }
      },
      'agent-team-roles: presets',
    )
  })

// 角色在创建窗口内绑定，不在宣告期绑：standard preset 的常驻 tool-subagent 行会给新建
// 子上下文装 injected fiber，晚绑会撞上它，也会把公告变成一次重挂。
  h.ctx.inject(['agentPresets', 'agents'], (scoped) => {
    const service = scoped.agentPresets
    const agents = scoped.agents
    if (service === undefined || service === null || typeof service.select !== 'function') return
    if (agents === undefined || agents === null) return

/** @param {any} childCtx @param {any} child @param {string} childId @param {any} lead */
    const bindChild = async (childCtx, child, childId, lead) => {
      const label = delegationLabel(child === null || child === undefined ? undefined : child.session)
      const memberName = pendingMemberName(scoped, lead, childId)
      const named =
        memberName === undefined ? undefined : roleForMemberName(h.store.roles, memberName, h.options.prefix)
      const role =
        named ?? (label === undefined ? undefined : roleForLabel(h.store.roles, label, h.options.prefix))
      if (role === undefined) return

      let composed = null
      try {
        composed = service.composedPreset?.(childCtx) ?? null
      } catch (error) {
        composed = `error:${String((error && error.message) || error)}`
      }
      if (composed === role.id) return

// 改过但还没被用到的角色在注册表里没有定义，select 会以 agent-preset/not-found 拒绝；
// 谁要用它，谁在这一刻把它挂起来。
      await lifecycle.ensureRegistered(service, role.id)

// 这里必须是 select，不能换 composeFrom：composeFrom 只能把父的 standing mount 绑给子上下文、
// 不收 preset id，用它「成功」的结果是孩子绑成父的角色并静默无效。
// select(agent, presetId) 是唯一能换到任意角色的公开入口。
      const who = memberName === undefined ? label : memberName
      const committed = await service.select(child, role.id)
      h.logger.info(
        `成员 ${who} 已绑定角色「${role.name}」（preset ${committed}，创建窗口，来源 ${
          named === undefined ? '描述' : '成员名'
        }）`,
      )
    }

/** 组装一次创建请求：保留所有字段，把我们这一步接在调用方自己的 setup 之后。
 * 不是被委派的子代理（没有 parentAgent）、没有请求对象、绑定关闭时返回 undefined。
 * @param {any} params @returns {any | undefined} */
    const compose = (params) => {
// 签名防御：上游 create/resume 目前是「一个请求对象」的单参签名；
// 别的形状（无参、字符串、数组、将来改成多参）原样透传，绝不静默改写。
      if (params === null || typeof params !== 'object' || Array.isArray(params)) return undefined
      if (!bindingEnabled(h.options, h.store.settings)) return undefined
      const childId =
        typeof params.sessionId === 'string'
          ? params.sessionId
          : typeof params.resumeSessionId === 'string'
            ? params.resumeSessionId
            : undefined
      const lead = params.parentAgent
      if (childId === undefined || lead === undefined || lead === null) return undefined
      const setup = params.setup
      return {
        ...params,
        setup: async (childCtx, child) => {
          if (typeof setup === 'function') await setup(childCtx, child)
// 角色组合涉及工具范围与权限模式，失败要上报并交给宣告期兜底，绝不静默降级成父的 preset。
          try {
            await bindChild(childCtx, child, childId, lead)
          } catch (error) {
            h.logger.warn(`成员角色绑定失败（创建窗口 ${childId}）：${String((error && error.message) || error)}`)
          }
        },
      }
    }

    scoped.effect(
      () => {
        const wrapped = []
        for (const method of ['create', 'resume']) {
          const original = agents[method]
          if (typeof original !== 'function') continue
// 卸载时 agents[method] 可能已被别的插件再包一层：直接写回 original 会丢掉别人的包装，
// 所以先把行为降级成纯透传（留在链上无害），只有还在链顶时才真换回原实现；重复或乱序卸载都安全。
          let active = true
          const patched = function createWithRole(params, ...rest) {
            if (!active) return original.call(this, params, ...rest)
            const composed = compose(params)
            return composed === undefined ? original.call(this, params, ...rest) : original.call(this, composed, ...rest)
          }
          agents[method] = patched
          wrapped.push({
            method,
            original,
            patched,
            detach() {
              active = false
            },
          })
        }
        if (wrapped.length === 0) {
          h.logger.warn('这个部署的 agents 服务没有 create/resume，角色只能在宣告后兜底绑定（§5.53）')
          return
        }
        h.logger.info(`§5.53 角色绑定已装到创建窗口：${wrapped.map(({ method }) => `agents.${method}`).join('、')}`)
        return () => {
          for (const { method, original, patched, detach } of wrapped) {
// 先断行为再尝试还原：两步都幂等，卸载跑两次也不会误伤别的插件。
            detach()
            if (agents[method] === patched) agents[method] = original
          }
        }
      },
      'agent-team-roles: creation window',
    )
  })
}
