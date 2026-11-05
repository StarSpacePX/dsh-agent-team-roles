// 客户端真正源码（lib/client.js 是 node tools/build-client.mjs 的产物，勿手改）。
// 插件入口：apply 与 name/inject。

import { foldTeamEvents } from './team-events.js';
import { command } from './net.js';
import { TeamRolesSection } from './section/team-roles.js';

const name = 'dsh-agent-team-roles';
const inject = ['slots', 'sessions'];

function apply(ctx) {
// 角色配置页放在会话页签栏（conversation.view 插槽）。
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

/** 名册：先用共享投影，事件窗口兜底。 */
    const rosterOf = (leadId) => {
      try {
        const values = ctx.sessions.list.getSnapshot().projectionsBySession[leadId]?.values;
        if (values !== undefined && values !== null && Array.isArray(values.agentTeam?.members)) {
          return values.agentTeam.members;
        }
      } catch {
// 回落到事件窗口
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
