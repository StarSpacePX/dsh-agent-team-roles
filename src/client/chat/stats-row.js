// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 群聊页签顶部：一行统计数字 + 成员名单 + 「加载更早的消息」。

import { React, h } from './../react.js';
import { chatStyles, styles } from './../styles.js';

function TeamChatStats({ p }) {
  const { roster, shown, pending, folded, leadIds, colorOfRow, rosterChipStyle, onLoadOlder, busy } = p;
  return h(
    React.Fragment,
    null,
    h(
      'div',
      { style: chatStyles.header },
// 一行「数字 + 标签」的 stat 块，不用通栏下划线分段。
      h(
        'span',
        { style: chatStyles.stat },
        h('span', { style: chatStyles.statValue }, roster.length),
        h('span', { style: chatStyles.statLabel }, '成员'),
      ),
      h(
        'span',
        { style: chatStyles.stat },
        h('span', { style: chatStyles.statValue }, shown.length),
        h('span', { style: chatStyles.statLabel }, '消息'),
      ),
      pending > 0
        ? h(
            'span',
            { style: chatStyles.stat },
            h('span', { style: { ...chatStyles.statValue, ...chatStyles.pending } }, pending),
            h('span', { style: chatStyles.statLabel }, '排队中'),
          )
        : null,
      folded.tasks.length > 0
        ? h(
            'span',
            { style: chatStyles.stat },
            h('span', { style: chatStyles.statValue }, folded.tasks.length),
            h('span', { style: chatStyles.statLabel }, '任务'),
          )
        : null,
      folded.hasMore ? h('span', { style: chatStyles.note }, '（历史未载完）') : null,
// 常态不标注日志范围，只有「历史未载完」还留着（那是真没读完，属于提示而非标注）。
    ),
// 顶部名单读的是合成后的 roster：Lead 是 Team 根会话、日志里没有它的 team/member 记录，
// 合成的那一行不能被绕过（可见性、渲染、「成员」计数同一口径）。
    roster.length > 0
      ? h(
          'div',
          { style: chatStyles.roster },
          roster.map((member) =>
            h(
              'span',
              {
                key: String(member.id),
// 顶部角色状态用自己的属性色做背景、白字。
                style: rosterChipStyle(colorOfRow(member.id, member.name)),
              },
              `${member.name}${leadIds.has(String(member.id)) ? '（Lead）' : ''} · ${member.phase}`,
            ),
          ),
        )
      : null,
    folded.hasMore
      ? h(
          'div',
          null,
          h(
            'button',
            { type: 'button', style: styles.button, onClick: onLoadOlder, disabled: busy },
            busy ? '加载中…' : '加载更早的消息',
          ),
        )
      : null,
  );
}

export { TeamChatStats };
