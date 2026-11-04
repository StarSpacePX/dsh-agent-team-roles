/**
 * dsh-agent-team-roles — host half / 成员绑定：创建窗口与宣告期兜底（§5.46、§5.53、§5.58 D1/D3）。
 *
 * 一个成员怎么知道自己是哪个角色？两种窗口，**创建窗口优先**：
 *
 * 1. §5.53 创建窗口：`agents.create` / `agents.resume` 的请求里本来就有 `setup` 回调，
 *    子代理的 preset 就是在那里挂上去的。我们在那里 `select` 这个角色，于是组合在任何
 *    `agent/created` 监听器跑之前就定下来了 —— 这一点是**必须**的：`preset-standard`
 *    自带一个常驻的 `tool-subagent` 行，它的 `agent/created` 监听器会往新子上下文里装
 *    注入纤维；从**我们**的 `agent/created` 监听器重绑 preset 会在那个纤维加载期间重写
 *    作用域链，把注入上下文在自己的回调下拆掉（`INACTIVE_EFFECT`），整个创建事务回滚。
 * 2. §5.46 宣告期兜底：给那些不走 `create`/`resume` 的创建路径用。成员自己的 Team 名
 *    是确定性的键（运行时校验过、唯一、且早于子会话就绪），描述符标签只是次选。
 *
 * @module dsh-agent-team-roles/host/bind
 */
import { roleForMemberName } from '../roles.js'
import { bindingEnabled, delegationLabel, memberNameOf, pendingMemberName, roleForLabel } from './config.js'
import { adoptMigratedRoles } from './adopt.js'

/**
 * @param {object} h - the shared host state ({@link ./context.js}).
 * @param {object} c - `{ lifecycle, team }`.
 */
export function installBind(h, c) {
  const { lifecycle, team } = c

  h.ctx.inject(['agentPresets'], (scoped) => {
    h.presets = scoped.agentPresets
    const service = h.presets

    scoped.effect(
      () => {
        let stopped = false

        /**
         * Bind a role to the member that was just delegated into existence.
         *
         * Every in-process child joins its *parent's* preset (`applyChildComposition`
         * in `dsh-subagent`), so a teammate normally inherits the Lead's role. With
         * `bindMembers`, the member's own Team name picks the role instead (§5.46);
         * a plain subagent, which has no Team name, still falls back to its
         * descriptor label.
         *
         * `agent/created` is the only correct window. `agentPresets.select()` refuses
         * a session that has begun (it throws `agent-preset/locked` once a turn is
         * open or finished), and this listener runs serially *before* creation
         * resolves — which is precisely the blank window the registry documents.
         */
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
          // §5.46 — the member's own Team name wins: it is a validated, unique
          // key, whereas `label` is the descriptor's free-form `description`
          // (`spawn_teammate` passes the description, never the name —
          // `…\dsh-experimental-agent-team\lib\index.js:576`), which is why the
          // old label-only match used to miss. The label stays as the fallback
          // so a plain `subagent` child still binds when it is named like a role.
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
          // §5.53 — the creation window (the inject block below) already bound the role,
          // so this listener is the **fallback** for a creation path that does not go
          // through `agents.create`/`agents.resume`. Skipping when the composition is
          // already the role is what keeps the announce free of a preset rebind — and of
          // the `INACTIVE_EFFECT` race a rebind here causes while `preset-standard`'s
          // standing `tool-subagent` listener is still loading its injected fiber.
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
            // §5.54 — 兜底路径同样得先按需挂载，否则 `select` 会 not-found。
            await lifecycle.ensureRegistered(service, role.id)
            const committed = await service.select(agent, role.id)
            // 兜底路径：这条创建方式没走 `agents.create`/`agents.resume`（§5.53），
            // 所以在这里补一次绑定；§5.52 的 post-select 探针已随验证通道删除。
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
            // §5.55 — 趁没人等，把那份要跨 Remote 读的部署组合清单先读掉。
            team.warmTeamCache()
          } catch (error) {
            h.logger.error(`agent team 角色初始化失败：${String((error && error.message) || error)}`)
          }
        })()

        return async () => {
          stopped = true
          // §5.58 A5 — must be set *before* `registered.clear()`: a registration
          // still in flight checks it on the way back.
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

  // §5.53 — the role is bound **inside the creation window**, not at the announce.
  //
  // Why: `preset-standard` carries a standing `tool-subagent` row
  // (`modelSelectionSettings: true`, `…\dsh-web-app\presets\standard.patch.yml:90-96`)
  // whose own `agent/created` listener installs an injected fiber into the new child
  // (`…\dsh-tool-subagent\lib\index.js:618-638` `installScoped`, `:652-654` the
  // listener). Re-binding the child's preset from *our* `agent/created` listener rewrites
  // the child's scope chain while that fiber is loading, which tears the injected context
  // down under its own callback (`…\cordis\lib\index.js:1142` → `install`'s
  // `runtimeCtx.on(...)` → `Fiber.assertActive` → `INACTIVE_EFFECT`), and the whole
  // creation transaction rolls back (`…\dsh-agent-loop\README.zh.md:111`).
  //
  // The creation window is the native place for this: dsh itself mounts a preset there
  // (`…\dsh-api-session-controller\lib\types\agent.js:388-401`:
  // `setup: async (agentCtx, agent) => { this.installSelection(agent); await presets.mount(agentCtx, resolvedId) }`),
  // and a child joins its parent's preset there (`…\dsh-subagent\lib\index.js:1068-1074`
  // `setup` → `applyChildComposition`). Selecting here settles the composition *before*
  // any `agent/created` listener runs, so nothing rewrites the scope chain mid-load.
  //
  // `agents.create` / `agents.resume` are the only creation entry points that accept a
  // `setup` (`…\dsh-subagent\lib\index.js:1076-1091` uses both), so both are wrapped —
  // and the caller's own setup is *composed*, never replaced.
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

      // §5.54 — 这个角色的配置改过、还没被用到时，注册表里根本没有它的定义，
      // `select` 会以 `agent-preset/not-found` 拒绝。谁要用它，谁就在这一刻把它挂起来
      // （这是「JSON 是元数据、用到才构建」里唯一真正构建的时刻）。
      await lifecycle.ensureRegistered(service, role.id)

      // §5.58 D3 — 为什么这里必须是 `select`，而不能换成 `composeFrom`：
      // `composeFrom(agentCtx, parentCtx)`（`Source\DSH\packages\preset\agent-presets\src\index.ts:484-493`）
      // 只能把**父的** standing mount 绑给子上下文（返回父的 preset id；父没 join 就返回
      // undefined），它根本不收 preset id —— 用它「成功」的结果是孩子绑成父的角色并静默无效。
      // 想换到任意角色，`select(agent, presetId)` 是唯一公开入口：按 `agent.id` 排队
      // （`:726-729`）→ 再查一次 turnBoundary 闸（`:743-751`，已经开跑就 `agent-preset/locked`）
      // → `recompose` 重解析名册（`:752`）→ 只把事实写进会话日志
      // `agent.session.append('agent-preset/selected', …)`（`:755`）。代价是重的，但语义是对的。
      // 另外谁都不要去写 `meta.agentPreset`：那是**记录字段**（`Source\DSH\packages\core\agent\src\index.ts:84`），
      // 只被透传进 session header、子创建点填的还是**父的** preset，不是选择钩子，写它同样静默无效。
      const who = memberName === undefined ? label : memberName
      const committed = await service.select(child, role.id)
      h.logger.info(
        `成员 ${who} 已绑定角色「${role.name}」（preset ${committed}，创建窗口，来源 ${
          named === undefined ? '描述' : '成员名'
        }）`,
      )
    }

    /**
     * Compose one creation request: keep every field, chain our step after the
     * caller's own `setup`. Returns undefined when this is not a delegated child
     * (no `parentAgent`), the caller passed no request object, or binding is off.
     *
     * @param {any} params
     * @returns {any | undefined}
     */
    const compose = (params) => {
      // Signature defence (§5.58 D1)：上游的 `create`/`resume` 今天是「一个请求对象」
      // 的单参签名，这个包装正是建立在这一点上。任何别的形状 —— 没传参、传字符串、
      // 传数组、将来上游改成多参 —— 都不是我们该碰的东西，原样透传，绝不静默改写。
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
          // A role is a security-relevant composition (tool scope, permission mode), so a
          // failure here is reported and left to the announce-time fallback — never
          // silently downgraded to the parent's preset.
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
          // §5.58 D1 — 卸载时 `agents[method]` 可能已经不是我们这个包装了（另一个插件
          // 在我们之后又包了一层）。那种情况下把 `agents[method]` 直接写回 `original`
          // 会把别人的包装一起丢掉，所以这里先把自己的行为断掉：包装退化成纯透传，
          // 留在链上也无害；只有当它还在链顶时才真的换回原实现。这样重复卸载、乱序
          // 卸载、别的插件插队都不会留下「我们的壳永远活着」。
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
            // 先断行为，再尝还原：两步都幂等，卸载跑两次也不会误伤别的插件。
            detach()
            if (agents[method] === patched) agents[method] = original
          }
        }
      },
      'agent-team-roles: creation window',
    )
  })
}
