// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 群聊正文的 markdown 作用域样式，加两个小组件辅助（宿主滚动条复位、展开行取第一行）。

import { blockText } from './fold.js';

// §5.66 — 群聊正文的作用域样式（只作用于自己这张卡片里的 markdown）。
// 背景：宿主 markdown 容器带着 `white-space: pre-wrap`（保留原始换行），它自己的 `p`
// 又有 16px 上下外边距 —— 一个空行既被当成一整行、又被边距算一遍（实测块间距 56px）。
// 这里只把块级元素外边距归零，`pre-wrap` 不动（单换行折行必须保留）。
// 选择器重复类名是为了提高权重，压过宿主 CSS module 里的同权重规则。
const MARKDOWN_CLASS = 'atr-chat-md';
const MARKDOWN_CSS = `
.atr-chat-md.atr-chat-md p,
.atr-chat-md.atr-chat-md ul,
.atr-chat-md.atr-chat-md ol,
.atr-chat-md.atr-chat-md pre,
.atr-chat-md.atr-chat-md blockquote,
.atr-chat-md.atr-chat-md table,
.atr-chat-md.atr-chat-md h1,
.atr-chat-md.atr-chat-md h2,
.atr-chat-md.atr-chat-md h3,
.atr-chat-md.atr-chat-md h4,
.atr-chat-md.atr-chat-md h5,
.atr-chat-md.atr-chat-md h6 { margin: 0; }
.atr-chat-md.atr-chat-md ul,
.atr-chat-md.atr-chat-md ol { padding-left: 22px; }
.atr-chat-md.atr-chat-md blockquote { padding-left: 10px; }
.atr-chat-md.atr-chat-md li { margin: 0; }
.atr-chat-md.atr-chat-md > :first-child { margin-top: 0; }
.atr-chat-md.atr-chat-md > :last-child { margin-bottom: 0; }
`;

// §5.68 — 2026-10-14 用户：「点开群聊，滚轮在底部，我还得手动滚到最上面」。
// 根因（真机实测）：宿主的会话滚动条是**所有页签共用的同一个** `scrollBody`（对话 / 群聊 / 轨迹
// 都在里面），切页签**不重置**它，群聊因此总在「上一次读到的位置」打开 —— 平时在对话里滚到底，
// 一进群聊就在很下面。做法：本视图从**隐藏转为可见**的那一刻，把最近的可滚动祖先拉回顶部；
// 只在边沿做一次，用户自己在群聊里滚动不会被拽回去（再切一次页签又会回到顶部）。
function resetHostScroll(node) {
  if (node === null || node === undefined || typeof globalThis.getComputedStyle !== 'function') return;
  for (let el = node.parentElement; el !== null && el !== undefined; el = el.parentElement) {
    const overflowY = globalThis.getComputedStyle(el).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) {
      el.scrollTop = 0;
      return;
    }
  }
}

// 展开行里的「完整标题」= 消息正文的第一行。不按字数硬切（用户要求把这一行占满），
// 超出宽度由 CSS 在行尾省略，完整正文挂在 `title` 上。
function firstLine(content) {
  // 正文常常以空行/空白开头（用户写在正文前的一两个换行），那时第一行是空串，
  // 展开行会整行空白。先去掉开头的空白行，再取剩下的第一行；整段没有内容时保持原样。
  const text = blockText(content).replace(/^(?:[^\S\n]*\n)+/, '');
  const cut = text.indexOf('\n');
  return cut === -1 ? text : text.slice(0, cut);
}

export { MARKDOWN_CLASS, MARKDOWN_CSS, firstLine, resetHostScroll };
