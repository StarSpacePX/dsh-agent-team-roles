// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 群聊页签下半段：消息流（收发胶囊 + 送达状态 + 时间 + markdown 正文）。

import { React, h } from './../react.js';
import { chatStyles } from './../styles.js';
import { OrderSwitch } from './order.js';
import { Markdown } from './../markdown.js';
import { blockText, formatClock } from './fold.js';
import { MARKDOWN_CLASS } from './markdown-style.js';

function TeamChatMessages({ p }) {
  const { ordered, order, pickOrder, colorOfRow, nameById, hoverKey, setHoverKey, fade, chipStyle } = p;
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
// 这一条的主色 = 发送者的角色色，整圈边框都用它；卡片底色与文字保持原样。
// 收件人 chip 用收件人自己的角色色，两边不做层级区分。
        const senderColor = colorOfRow(message.senderId, message.senderName);
        const targetName = nameById.get(String(message.targetId));
        const targetColor = targetName === undefined ? null : colorOfRow(message.targetId, targetName);
// 整圈边框仍是发送者色，但平时只到 40% 淡色，鼠标停留在这一条上才转实色。
        const rowKey = `${row.seq}:${message.id}`;
        return h(
          'div',
          {
            key: rowKey,
            style: {
              ...chatStyles.message,
              borderColor: hoverKey === rowKey ? senderColor : fade(senderColor, 0.4),
            },
            onMouseEnter: () => setHoverKey(rowKey),
            onMouseLeave: () => setHoverKey(null),
          },
          h(
            'div',
            { style: chatStyles.meta },
            h('span', { style: chipStyle(senderColor) }, message.senderName),
// 箭头自己一格，夹在收发两个胶囊中间。
            targetName === undefined ? null : h('span', { style: chatStyles.arrow }, '→'),
            targetName === undefined ? null : h('span', { style: chipStyle(targetColor) }, targetName),
            h(
              'span',
              { style: chatStyles.metaRight },
// 时间固定淡紫，不跟状态色走；送达状态保持原样。
              h('span', { style: chatStyles.time }, formatClock(row.time)),
              h(
                'span',
                { style: row.delivered === true ? chatStyles.ok : chatStyles.failed },
                row.delivered === true ? '已送达' : '排队中',
              ),
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
        );
      }),
    ),
  );
}

export { TeamChatMessages };
