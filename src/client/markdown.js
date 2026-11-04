// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 宿主自带的 markdown 渲染器：官方聊天正文用的就是 `MarkdownText`（`@deepseek-ai/dsh-client-ui-primitives`
// 的导出，含它自己的样式表）。**不自己写解析器**，也不抄它的样式。
// 构建器只允许相对 import，平台模块必须用 `require` 原样透传（同 react.js）。
// 老版本 dsh 没导出时保持 null，调用方退回纯文本，不白屏。

import { h } from './react.js';

let MarkdownText = null;
try {
  const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
  // ⚠️ 它是 `memo(...)` 的产物 —— `typeof` 是 **object** 不是 function，别用 typeof 判断，
  // 否则整段静默退回纯文本（这个坑踩过一次）。
  const candidate = primitives === null || primitives === undefined ? undefined : primitives.MarkdownText;
  if (candidate !== undefined && candidate !== null) MarkdownText = candidate;
} catch {
  MarkdownText = null;
}

// §5.67 — 2026-10-14 真机事故：宿主渲染器把「代码围栏」的复制按钮文案读成
// `context.labels.code.copyLabel`（`MarkdownLabels`，见 primitives 的
// `lib/types/markdown/render.d.ts:32-35`）。插件只传 `text`/`variant` 时 `labels` 是
// undefined → 渲染任意带代码围栏的正文即抛 `TypeError: Cannot read properties of
// undefined (reading 'code')`，整个 `conversation.view` 插槽被错误边界摘掉 ——
// 现象就是「群聊」页签整片空白（页签本身还在）。这里由插件自己补齐这份契约。
const MARKDOWN_LABELS = {
  code: {
    copyLabel: '复制',
    copiedLabel: '已复制',
    // 代码卡片的标题栏：语言缺失时的标题 + 换行/不换行两个动作（`CodeToolbarLabels`）。
    toolbarLabels: { codeLabel: '代码', wrapLabel: '换行', unwrapLabel: '不换行' },
  },
  footnotes: '脚注',
};

// 统一入口：永远补上 `labels`，调用方不必知道宿主这份契约；将来宿主改形状也只在这里跟。
const Markdown =
  MarkdownText === null
    ? null
    : function Markdown(props) {
        const labels = props.labels === undefined || props.labels === null ? MARKDOWN_LABELS : props.labels;
        return h(MarkdownText, { ...props, labels });
      };

export { Markdown, MarkdownText, MARKDOWN_LABELS };
