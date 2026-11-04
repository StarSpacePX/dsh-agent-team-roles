// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 群聊正文的 markdown 作用域样式，加两个小组件辅助（宿主滚动条复位、展开行取第一行）。

import { blockText } from './fold.js';

// 群聊正文的作用域样式（只作用于自己这张卡片里的 markdown）：
// 宿主 markdown 容器带 white-space: pre-wrap，段落又有 16px 上下外边距，一个空行被算两遍。
// 这里只把块级元素外边距归零，pre-wrap 不动；选择器重复类名是为了压过宿主 CSS module 的权重。
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

// 宿主的会话滚动条是所有页签共用的同一个 scrollBody，切页签不重置它。
// 做法：本视图从隐藏转为可见那一刻，把最近的可滚动祖先拉回顶部；
// 只在边沿做一次，用户自己在群聊里滚动不会被拽回去。
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

// 展开行的「完整标题」= 消息正文第一行；超出宽度由 CSS 省略，完整正文挂在 title 上。
function firstLine(content) {
// 正文常以空行开头（正文前一两个换行），那时第一行是空串、展开行会整行空白。
// 先去掉开头的空白行再取第一行；整段没内容时保持原样。
  const text = blockText(content).replace(/^(?:[^\S\n]*\n)+/, '');
  const cut = text.indexOf('\n');
  return cut === -1 ? text : text.slice(0, cut);
}

export { MARKDOWN_CLASS, MARKDOWN_CSS, firstLine, resetHostScroll };
