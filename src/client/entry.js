// 客户端真正源码（lib/client.js 是 node tools/build-client.mjs 的产物，勿手改）。
// 插件入口：apply 与 name/inject。

import { TeamChatView } from './chat/view.js';
import { chatTab } from './entries.js';
import { command, fetchArbiterWorkspace, fetchState } from './net.js';
import { TeamRolesSection } from './section/team-roles.js';

const name = 'dsh-agent-team-roles';
const inject = ['slots', 'sessions'];

function apply(ctx) {
// 角色配置页放在会话页签栏，和「群聊」并排（同一个 conversation.view 插槽，排在群聊之后）。
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

// 把团队群聊挂成「对话」/「轨迹」之外的一个页签，并允许用户隐藏：挂载前读 settings.hideChatTab。
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
// 同团队其它会话的 eventSource：一条转达消息只落在收件人的会话里，这一页要把两边的
// 窗口都订阅上才看得到完整的收发。
              withPeers: (ids, selfId) => {
                const peers = [];
                for (const id of Array.isArray(ids) ? ids : []) {
                  const peerId = String(id);
                  if (peerId === String(selfId)) continue;
                  try {
                    const peerSource = ctx.sessions.binding(peerId)?.session?.eventSource;
                    if (
                      peerSource !== undefined &&
                      peerSource !== null &&
                      typeof peerSource.getSnapshot === 'function'
                    ) {
                      peers.push({ id: peerId, source: peerSource });
                    }
                  } catch {
// 该会话还没绑定上（成员刚创建）：下一轮 pageIds 变化会重新订阅。
                  }
                }
                return peers;
              },
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

// 普通会话看群聊、监察员工作区看监察群：进了监察员工作区就把这个页签卸掉，让位给 dsh-arbiter-roles。
// 判据只有一个来源——dsh-arbiter 自己 /state 的 workspaceDir；读不到就 fail open，不因一次失败藏掉页签。
  ctx.effect(() => {
    let arbiterDir = ''
    const normalize = (value) => {
      if (typeof value !== 'string') return ''
      let text = value.trim().replace(/\\/gu, '/')
      while (text.length > 1 && text.endsWith('/')) text = text.slice(0, -1)
      return text.toLowerCase()
    }
/** 当前会话是否已经在监察员工作区里（读不到时一律 false）。 */
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
// 末段同名也算同一个工作区（盘符或挂载点不同不影响），与 dsh-arbiter 一致。
      const inside =
        wanted !== '' && cwd !== '' && (cwd === wanted || cwd.split('/').pop() === wanted.split('/').pop())
      chatTab.setOutOfScope(inside)
    }
// uiSession 由别的插件提供，比本插件晚就绪是常态：ctx.get 那一刻还是 undefined，
// 订阅就永远建不起来。用 ctx.inject 等它就绪，服务重建时 cordis 会重新执行这一段。
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
// 会话表不可订阅时只靠当前会话的变化，够用。
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
// fail open：多显示一个不该显示的页签可恢复，因一次读取失败而藏掉用户想要的页签不可恢复。
        if (!chatTab.stopped) chatTab.setHidden(false)
      },
    )
    return () => {
      chatTab.stopped = true
      chatTab.unmount()
    }
  }, 'dsh-agent-team-roles: team chat view')

// R5：「@成员 正文」直接发给成员，不进 Lead 的会话。
// 本版对 @ 没有 Enter 裁决，所以用空格认领：成员名后的空格把这一行交给我们，随后的 Enter
// 用正文作为参数提交，草稿因此永远不会到模型那里。
  ctx.inject(['inputTriggers'], (scoped) => {
    const inputTriggers = scoped.inputTriggers;
    if (
      inputTriggers === undefined ||
      inputTriggers === null ||
      typeof inputTriggers.registerSource !== 'function'
    ) {
      return;
    }

/** 草稿所在的会话 → 它的 Lead。 */
    const leadIdOf = (sessionId) => {
      try {
        const snapshot = ctx.sessions.binding(sessionId)?.session?.getSnapshot?.();
        const parent = snapshot?.subagent?.address?.parentSessionId;
        return typeof parent === 'string' && parent.length > 0 ? parent : sessionId;
      } catch {
        return sessionId;
      }
    };

/** 名册：宿主同步过来的 team 投影（实时，不需要自己折事件）。 */
    const rosterOf = (leadId) => {
      try {
        const values = ctx.sessions.list.getSnapshot().projectionsBySession[leadId]?.values;
        if (values !== undefined && values !== null && Array.isArray(values.agentTeam?.members)) {
          return values.agentTeam.members;
        }
      } catch {
// 投影还没同步过来时按「没有成员」处理（@ 补全退化成不提示）。
      }
      return [];
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

/** 把这一行认领为自己的命令：token 保留尾随空格（这才是进入认领态的原因），
 * 所以后面的文字作为 args 到来，草稿永远不会到模型。
 * @param {object} draft @returns {object | null} */
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
// 不是成员 → 把 token 交回默认 sink，文件和会话引用照旧工作。
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
