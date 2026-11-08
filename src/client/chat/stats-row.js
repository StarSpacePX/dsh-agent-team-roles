// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 群聊页签顶部：一张卡里放「统计数字 + 竖分隔 + 成员名单（色点 + 名字 + 阶段）」。

import { React, h } from './../react.js';
import { chatStyles, styles } from './../styles.js';

function TeamChatStats({ p }) {
  const { roster, shown, pending, folded, colorOfRow, rosterChipStyle, dotStyle, onLoadOlder, busy } = p;
  return h(
    'div',
    { style: chatStyles.cardTop },
    h(
      'div',
      { style: chatStyles.header },
// 一行「数字 + 标签」的 stat 块，不再各自套小框。
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
    ),
// 统计与成员之间一条竖分隔；名单读的是合成后的 roster（Lead 是 Team 根会话，日志里没有它的记录）。
    roster.length > 0 ? h('span', { style: chatStyles.headerDivider }) : null,
    roster.length > 0
      ? h(
          'div',
          { style: chatStyles.roster },
          roster.map((member) => {
            const color = colorOfRow(member.id, member.name);
            return h(
              'span',
              { key: String(member.id), style: rosterChipStyle(color) },
              h('i', { style: dotStyle(color) }),
              `${member.name} · ${member.phase}`,
            );
          }),
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
