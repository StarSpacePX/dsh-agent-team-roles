// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 群聊页签下半段：消息流（左色轨 + 谁→谁 + markdown 正文，右侧时间与送达状态一行一列）。

import { React, h } from './../react.js';
import { chatStyles } from './../styles.js';
import { OrderSwitch } from './order.js';
import { Markdown } from './../markdown.js';
import { blockText, formatClock } from './fold.js';
import { MARKDOWN_CLASS } from './markdown-style.js';

function TeamChatMessages({ p }) {
  const { ordered, order, pickOrder, colorOfRow, nameById, hoverKey, setHoverKey, fade, chipStyle, dotStyle } = p;
  return h(
    React.Fragment,
    null,
    h(
      'div',
      { style: chatStyles.sectionBar },
      h('span', { style: chatStyles.sectionTitle }, '消息流'),
      // ↑ / ↓ 点一下就换，当前生效的一侧高亮；默认倒序（最新在上）。
      h(OrderSwitch, { order: order, onPick: pickOrder }),
    ),
    h(
      'div',
      { style: chatStyles.list },
      ordered.map((row) => {
        const message = row.message;
// 这一条的主色 = 发送者的角色色，只用在左侧 2px 色轨上；
// 收件人用收件人自己的角色色点，两边不做层级区分。
        const senderColor = colorOfRow(message.senderId, message.senderName);
        const targetName = nameById.get(String(message.targetId));
        const targetColor = targetName === undefined ? null : colorOfRow(message.targetId, targetName);
// 色轨平时只到 55% 淡色，鼠标停留在这一条上才转实色并给一层极浅底色。
        const rowKey = `${row.seq}:${message.id}`;
        const hovered = hoverKey === rowKey;
        return h(
          'div',
          {
            key: rowKey,
            style: {
              ...chatStyles.message,
              borderLeftColor: hovered ? senderColor : fade(senderColor, 0.55),
              background: hovered ? chatStyles.rowHover.background : 'transparent',
            },
            onMouseEnter: () => setHoverKey(rowKey),
            onMouseLeave: () => setHoverKey(null),
          },
// 主体：谁 → 谁 一行，正文跟在下面。
          h(
            'div',
            { style: chatStyles.msgMain },
            h(
              'div',
              { style: chatStyles.meta },
              h(
                'span',
                { style: chipStyle(senderColor) },
                h('i', { style: dotStyle(senderColor) }),
                message.senderName,
              ),
// 箭头自己一格，夹在收发两个名字中间。
              targetName === undefined ? null : h('span', { style: chatStyles.arrow }, '→'),
              targetName === undefined
                ? null
                : h(
                    'span',
                    { style: chipStyle(targetColor) },
                    h('i', { style: dotStyle(targetColor) }),
                    targetName,
                  ),
            ),
// 正文交给宿主自己的 markdown 渲染器（官方聊天正文同款），拿不到就退回纯文本。
            Markdown === null
              ? h('pre', { style: chatStyles.body }, blockText(message.content))
              : h(
                  'div',
                  { className: MARKDOWN_CLASS, style: chatStyles.body },
                  h(Markdown, { text: blockText(message.content), variant: 'body' }),
                ),
          ),
// 右侧独立一列：时间在上、送达状态在下，统一右对齐。
          h(
            'div',
            { style: chatStyles.metaCol },
            h('span', { style: chatStyles.time }, formatClock(row.time)),
            h(
              'span',
              { style: row.delivered === true ? chatStyles.ok : chatStyles.failed },
              row.delivered === true ? '已送达' : '排队中',
            ),
          ),
        );
      }),
    ),
  );
}

export { TeamChatMessages };
