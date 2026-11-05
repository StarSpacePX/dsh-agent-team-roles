// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 宿主自带的 markdown 渲染器：官方聊天正文用的就是 MarkdownText（@deepseek-ai/dsh-client-ui-primitives 导出，含样式表）。
// 不自己写解析器，也不抄它的样式。构建器只允许相对 import，平台模块必须用 require 原样透传。
// 老版本 dsh 没导出时保持 null，调用方退回纯文本，不白屏。

import { h } from './react.js';

let MarkdownText = null;
try {
  const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
// 它是 memo(...) 的产物：typeof 是 object 不是 function，别用 typeof 判断，
// 否则整段静默退回纯文本。
  const candidate = primitives === null || primitives === undefined ? undefined : primitives.MarkdownText;
  if (candidate !== undefined && candidate !== null) MarkdownText = candidate;
} catch {
  MarkdownText = null;
}

// 宿主渲染器从 context.labels.code.copyLabel 读代码围栏复制按钮的文案；
// 只传 text / variant 时 labels 是 undefined，渲染任意带代码围栏的正文即抛 TypeError，
// 整个 conversation.view 插槽被错误边界摘掉时的兜底。这里由插件自己补齐契约。
const MARKDOWN_LABELS = {
  code: {
    copyLabel: '复制',
    copiedLabel: '已复制',
    // 代码卡片的标题栏：语言缺失时的标题 + 换行/不换行两个动作（`CodeToolbarLabels`）。
    toolbarLabels: { codeLabel: '代码', wrapLabel: '换行', unwrapLabel: '不换行' },
  },
  footnotes: '脚注',
};

// 统一入口：永远补上 labels，调用方不必知道宿主这份契约。
const Markdown =
  MarkdownText === null
    ? null
    : function Markdown(props) {
        const labels = props.labels === undefined || props.labels === null ? MARKDOWN_LABELS : props.labels;
        return h(MarkdownText, { ...props, labels });
      };

export { Markdown, MarkdownText, MARKDOWN_LABELS };
