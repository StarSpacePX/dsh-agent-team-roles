// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 插件入口：apply + name/inject（构建器 return 的模块命名空间）。

import { foldTeamEvents } from './chat/fold.js';
import { TeamChatView } from './chat/view.js';
import { chatTab } from './entries.js';
import { command, fetchArbiterWorkspace, fetchState } from './net.js';
import { TeamRolesSection } from './section/team-roles.js';

const name = 'dsh-agent-team-roles';
const inject = ['slots', 'sessions'];

function apply(ctx) {
  // 用户 m10429：「把这个设置搬到标签页上面去，参考群聊」——角色配置页从设置页
  // 搬进会话页签栏，和「群聊」并排（同一个 conversation.view 插槽，顺序排在群聊之后）。
  ctx.effect(
    () =>
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          { name: 'conversation.view', id: 'team-roles', order: 30, label: () => '角色' },
          TeamRolesSection,
        ),
      ),
    'dsh-agent-team-roles: roles tab',
  );

  // R7.5 / R7.7 — mount the team chat as its own tab beside 「对话」/「轨迹」.
  // R6 — and let the user hide it: `settings.hideChatTab` is read before the
  // tab is mounted, and the settings panel flips it live through `chatTab`.
  chatTab.mount = () => {
    if (chatTab.disposer !== null || chatTab.stopped) return
    chatTab.disposer = ctx.slots.inject('conversation.view', () =>
      ctx.slots.register(
        {
          name: 'conversation.view',
          id: 'team-chat',
          order: 20,
          label: () => '群聊',
          inject: (sessionId) => {
            const session = ctx.sessions.binding(sessionId)?.session;
            if (session === undefined) {
              throw new Error(`dsh-agent-team-roles: session "${sessionId}" is unavailable`);
            }
            const source = session.eventSource;
            return {
              sessionId,
              subscribe: (listener) => source.subscribe(listener),
              getWindow: () => source.getSnapshot(),
              loadOlder:
                typeof session.loadOlder === 'function'
                  ? async () => {
                      const before = source.getSnapshot();
                      await session.loadOlder();
                      return source.getSnapshot() !== before;
                    }
                  : undefined,
            };
          },
        },
        TeamChatView,
      ),
    )
  };
  chatTab.unmount = () => {
    if (chatTab.disposer === null) return
    chatTab.disposer()
    chatTab.disposer = null
  };

  // 「普通会话看群聊、监察员工作区看监察群」（用户 m01013/m01040）：进了监察员
  // 工作区就把这个「群聊」页签卸掉，让位给 dsh-arbiter-roles 的「监察群」。
  // 判据只有一个来源——dsh-arbiter 自己 /state 的 `workspaceDir`，我们不另配
  // 路径；读不到就 fail open（照旧显示），绝不因为一次失败把人页签藏没了。
  ctx.effect(() => {
    let arbiterDir = ''
    const normalize = (value) => {
      if (typeof value !== 'string') return ''
      let text = value.trim().replace(/\\/gu, '/')
      while (text.length > 1 && text.endsWith('/')) text = text.slice(0, -1)
      return text.toLowerCase()
    }
    /** 当前会话是否已经在监察员工作区里（工作区读不到时一律 false）。 */
    const syncWith = (current) => () => {
      let sessionId
      try {
        sessionId = current?.getSnapshot?.()?.key
      } catch {
        sessionId = undefined
      }
      const wanted = normalize(arbiterDir)
      let cwd = ''
      try {
        cwd = normalize(ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd)
      } catch {
        cwd = ''
      }
      // 末段同名也算同一个工作区（盘符/挂载点不同不影响），与 dsh-arbiter 一致。
      const inside =
        wanted !== '' && cwd !== '' && (cwd === wanted || cwd.split('/').pop() === wanted.split('/').pop())
      chatTab.setOutOfScope(inside)
    }
    // `uiSession` 由别的插件提供，比本插件晚就绪是常态：`ctx.get` 那一刻可能还是
    // undefined，那样订阅就永远建不起来（10/18 的 bug：监察员工作区里 [群聊] 还在）。
    // 用 `ctx.inject` 等它就绪，服务重建时 cordis 会重新执行这一段。
    let sync = () => {}
    let scopeStop = null
    ctx.inject(['uiSession'], (scoped) => {
      const current = scoped.uiSession?.adapter?.current
      sync = syncWith(current)
      const disposers = []
      if (current && typeof current.subscribe === 'function') disposers.push(current.subscribe(sync))
      try {
        if (typeof ctx.sessions?.list?.subscribe === 'function') disposers.push(ctx.sessions.list.subscribe(sync))
      } catch {
        // 会话表不可订阅时只靠当前会话的变化，够用了。
      }
      scopeStop = () => {
        for (const off of disposers) {
          try {
            off()
          } catch {
            // 退订失败不该影响卸载。
          }
        }
      }
      sync()
      return () => {
        scopeStop = null
        sync = () => {}
        for (const off of disposers) {
          try {
            off()
          } catch {
            // 退订失败不该影响卸载。
          }
        }
      }
    })
    fetchArbiterWorkspace().then(
      (dir) => {
        arbiterDir = dir
        sync()
      },
      () => {
        arbiterDir = ''
        sync()
      },
    )
    sync()
    return () => {
      if (scopeStop !== null) scopeStop()
    }
  }, 'dsh-agent-team-roles: chat tab scope')

  ctx.effect(() => {
    chatTab.stopped = false
    fetchState().then(
      (state) => {
        if (!chatTab.stopped) chatTab.setHidden(state.hideChatTab === true)
      },
      () => {
        // Fail open: showing an unwanted tab is recoverable, hiding a
        // wanted one behind a failed read is not.
        if (!chatTab.stopped) chatTab.setHidden(false)
      },
    )
    return () => {
      chatTab.stopped = true
      chatTab.unmount()
    }
  }, 'dsh-agent-team-roles: team chat view')

  // §5.45 — R5: 「@成员 正文」直接发给成员，不进 Lead 的会话。
  //
  // Enter adjudication does not exist for `@` in this build (the
  // conversation shell only sends `/` lines to the sources), so the claim
  // rides **space** instead: the space after a member name hands the line
  // to us as a claimed command, and the Enter that follows submits it with
  // the body as the argument. Either way the draft is consumed.
  //
  // Optional injection on purpose: a profile without the input-trigger
  // bundle keeps the roles panel and the 群聊 tab working.
  ctx.inject(['inputTriggers'], (scoped) => {
    const inputTriggers = scoped.inputTriggers;
    if (
      inputTriggers === undefined ||
      inputTriggers === null ||
      typeof inputTriggers.registerSource !== 'function'
    ) {
      return;
    }

    /** The Session a draft is typed in, mapped to the Lead whose team it is. */
    const leadIdOf = (sessionId) => {
      try {
        const snapshot = ctx.sessions.binding(sessionId)?.session?.getSnapshot?.();
        const parent = snapshot?.subagent?.address?.parentSessionId;
        return typeof parent === 'string' && parent.length > 0 ? parent : sessionId;
      } catch {
        return sessionId;
      }
    };

    /** Roster: the shared projection first, the event window as the fallback. */
    const rosterOf = (leadId) => {
      try {
        const values = ctx.sessions.list.getSnapshot().projectionsBySession[leadId]?.values;
        if (values !== undefined && values !== null && Array.isArray(values.agentTeam?.members)) {
          return values.agentTeam.members;
        }
      } catch {
        // fall through to the event window
      }
      try {
        const window = ctx.sessions.binding(leadId)?.session?.eventSource?.getSnapshot?.();
        return window === undefined || window === null ? [] : foldTeamEvents(window).members;
      } catch {
        return [];
      }
    };

    const teammatesOf = (leadId) =>
      rosterOf(leadId).filter(
        (member) =>
          member !== null &&
          typeof member === 'object' &&
          typeof member.name === 'string' &&
          member.name.length > 0 &&
          member.role !== 'lead' &&
          member.phase !== 'failed',
      );

    const teammateNamed = (leadId, name) =>
      teammatesOf(leadId).find((member) => member.name === name);

    /**
     * Claim the line as our own command: `token` keeps the trailing space
     * (that is what puts the input into claimed mode), so the text after it
     * arrives as `args` and the draft never reaches the model.
     */
    const claimFor = (leadId, name, shown) => ({
      name: '@team-member',
      token: `${shown} `,
      hint: `直接发给 ${name}`,
      submit: async (args) => {
        const text = String(args ?? '').trim();
        if (text === '') return { kind: 'error', text: '正文是空的，没有发送。' };
        try {
          await command({ action: 'team-send', sessionId: leadId, target: name, body: text });
          return { kind: 'success' };
        } catch (error) {
          return { kind: 'error', text: String((error && error.message) || error) };
        }
      },
    });

    const source = {
      trigger: '@',
      name: 'agent-team-member',
      order: -10,
      showGroupTitle: false,
      async candidates(session, request) {
        const query = String(request?.query ?? '')
          .replace(/^@/u, '')
          .trim()
          .toLowerCase();
        return teammatesOf(leadIdOf(session.sessionId))
          .filter((member) => query === '' || member.name.toLowerCase().startsWith(query))
          .map((member) => ({ name: member.name, label: member.name, hint: '直接发送' }));
      },
      matchSpace(session, token) {
        const name = String(token ?? '').replace(/^@/u, '');
        if (name === '') return undefined;
        const leadId = leadIdOf(session.sessionId);
        // Not a member → hand the token back to the default sink, so file
        // and Session references keep working exactly as before.
        if (teammateNamed(leadId, name) === undefined) return undefined;
        return { claim: claimFor(leadId, name, `@${name}`) };
      },
      onPick({ candidate, session, action }) {
        if (action !== 'pick') return undefined;
        const name = String(candidate?.name ?? '');
        if (name === '') return undefined;
        const leadId = leadIdOf(session.sessionId);
        if (teammateNamed(leadId, name) === undefined) return undefined;
        return { claim: claimFor(leadId, name, `@${name}`) };
      },
    };

    scoped.effect(() => inputTriggers.registerSource(source), 'agent-team-roles: @ member source');
  });
}

export { apply, name, inject };
