// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 群聊 tab 视图（R7.5 / R7.7 / R7.8）：只负责取数、算派生值与装配，四段渲染在 chat/ 下的兄弟模块。

import { React, h } from './../react.js';
import { chatStyles } from './../styles.js';
import { chat, withAlpha } from './../tokens.js';
import { useRoleColors } from './colors.js';
import { foldTeamEvents, mergeTeamLog } from './fold.js';
import { foldPairs, useEventWindow, useTeamProjection } from './hooks.js';
import { useOrder } from './order.js';
import { MARKDOWN_CSS, resetHostScroll } from './markdown-style.js';
import { TeamChatEmpty } from './empty-view.js';
import { TeamChatStats } from './stats-row.js';
import { TeamChatGraph } from './graph-view.js';
import { TeamChatMessages } from './message-list.js';
function TeamChatView(props) {  const window = useEventWindow(props.subscribe, props.getWindow);
  const local = React.useMemo(() => foldTeamEvents(window), [window]);
  // §5.50 — the host's own projection of this Session's log. It arrives a
  // little late and may never arrive (runtime off / Session not live), in
  // which case `mergeTeamLog` hands back exactly what §5.48 produced.
  const projection = useTeamProjection(props.sessionId);
  const folded = React.useMemo(() => mergeTeamLog(local, projection), [local, projection]);
  const [busy, setBusy] = React.useState(false);
  const [expanded, setExpanded] = React.useState(() => new Set());
  const [range, setRange] = React.useState(null);
  const [order, pickOrder] = useOrder();
  // §5.59 — 角色颜色来自 `/state` 的角色表（角色自己的 `role.json` 里那个 `color`）。
  const roleColors = useRoleColors();

  // §5.48 — the shell hands this view a **bounded tail** of the session log, not
  // the whole conversation: measured on the 28.9k-entry session this plugin was
  // built against, the window held 1041 entries covering seq 27883–28923, while
  // the session's eight `team/*` records sat at seq 21801–21862. A team that
  // worked earlier in a long session is therefore *outside* the window, and the
  // tab used to render 「本会话还没有群聊记录」 for a session that plainly had one.
  // The event source can page backwards (`session.loadOlder`), so the empty state
  // walks back by itself and offers a button for more.
  const loadOlderRef = React.useRef(props.loadOlder);
  loadOlderRef.current = props.loadOlder;
  const canPage = typeof props.loadOlder === 'function';
  const [scan, setScan] = React.useState({ running: false, rounds: 0, error: false });
  const runScan = (rounds) => {
    const load = loadOlderRef.current;
    if (typeof load !== 'function') return;
    setScan((current) => (current.running ? current : { running: true, rounds: current.rounds, error: false }));
    // 记账口径 = **实际往前翻成功的段数**：`load()` 返回 `false` 表示已经到顶，
    // 抛错表示这次读失败 —— 两种都不能按满 `rounds` 累加，否则「已经往前翻了 N 段」是假的。
    // 失败必须留下可见提示（`scan.error`），不能静默回到原样。
    let done = 0;
    const step = async (left) => {
      if (left <= 0) return 0;
      const changed = await load();
      if (changed === false) return 0;
      done += 1;
      return 1 + (await step(left - 1));
    };
    step(rounds).then(
      () => setScan((current) => ({ running: false, rounds: current.rounds + done, error: false })),
      () => setScan((current) => ({ running: false, rounds: current.rounds + done, error: true })),
    );
  };

  // A `team/member` record is a `TeamMemberSnapshot`, which carries no `role`
  // or `status`: the Lead is the Team root, and `TeamId` is that Session's id.
  const leadId = folded.teamId === null ? props.sessionId : folded.teamId;
  const leadIds = new Set(leadId === null || leadId === undefined ? [] : [String(leadId)]);
  const nameById = new Map(folded.members.map((member) => [String(member.id), member.name]));
  for (const id of leadIds) if (nameById.has(id) !== true) nameById.set(id, 'lead');
  // The Lead is the Team root Session and is never logged as a `team/member`
  // record, so its roster row is synthesized when the log does not carry one.
  const roster =
    leadId === null || leadId === undefined || folded.members.some((m) => String(m.id) === String(leadId))
      ? folded.members
      : [{ id: leadId, name: 'lead', phase: 'active' }, ...folded.members];

  // §5.59 — 颜色按「这个人是谁」取：Lead 固定深紫，其他角色用自己 `role.json` 里的颜色。
  // 发送者、收件人、依赖图两端的名字都用同一种 chip：只有颜色不同，不分主次。
  const colorOfRow = (id, name) =>
    leadIds.has(String(id)) ? roleColors.lead : roleColors.colorFor(id, name);
  const chipStyle = (color) => ({ ...chatStyles.nameChip, background: color, color: chat.chipText });
  // 顶部成员名单用同一个 chip 形状，只是圆角更大（胶囊）。
  const rosterChipStyle = (color) => ({ ...chipStyle(color), borderRadius: 999, padding: '2px 10px' });
  // 2026-10-13 减框改版（方案 A）：消息卡的整圈边框平时只到发送者色的 40%（线太密会显得
  // 不精致），鼠标移到这一条上才转成实色；依赖图行同理，平时无底色、悬停给极浅底色。
  // 调淡这件事（含颜色字符串拼接）关在 `tokens.js` 里，这里只调用。
  const fade = withAlpha;
  const [hoverKey, setHoverKey] = React.useState(null);
  // 2026-10-13「点击再取消后框框不见了」：两个下拉框改成自绘（`appearance:none`）之后，
  // 浏览器那圈原生焦点外观就没有了，焦点改成自己用边框深浅表示（0.28 → 0.6）。
  const [focusKey, setFocusKey] = React.useState(null);
  const selectStyle = (key) =>
    focusKey === key ? { ...chatStyles.select, borderColor: chat.focusRing } : chatStyles.select;

  // R7.8 — the default cycle spans the first Lead @ → the latest message, so a member
  // reply that lands after the last @ stays visible (ending at leadRows[last] would clip it).
  // The two @ pickers can only name Lead @ points, so "latest" is its own empty option
  // value instead of the id of some lead row.
  const leadRows = folded.messages.filter((row) => leadIds.has(String(row.message.senderId)));
  const latest = folded.messages[folded.messages.length - 1];
  const boundRow = (messageId, fallback) =>
    messageId === undefined || messageId === null || messageId === ''
      ? fallback
      : leadRows.find((row) => row.message.id === messageId) ?? fallback;
  const cycleStart = boundRow(range === null ? undefined : range.startId, leadRows[0]);
  const cycleEnd = boundRow(range === null ? undefined : range.endId, latest ?? leadRows[leadRows.length - 1]);
  const startSeq = cycleStart === undefined ? Number.NEGATIVE_INFINITY : cycleStart.seq;
  const endSeq = cycleEnd === undefined ? Number.POSITIVE_INFINITY : cycleEnd.seq;
  // The two @ pickers are independent, so "start after end" is reachable.
  // That span is genuinely empty — say so, instead of rendering a blank tab
  // that looks like the session has no messages at all.
  const inverted = Number.isFinite(startSeq) && Number.isFinite(endSeq) && startSeq > endSeq;
  const shown = inverted ? [] : folded.messages.filter((row) => row.seq >= startSeq && row.seq <= endSeq);
  // 只改渲染顺序：统计、@ 配对、翻页都仍然按时间正序处理 `shown`。
  const newestFirst = order !== 'asc';
  const ordered = newestFirst ? [...shown].reverse() : shown;
  const pairs = foldPairs(shown, nameById);
  // 用户 2026-10-13：「把角色的框框固定长度，不要各自一个长度，哪怕多留一点」——按这一屏
  // 出现过的角色名估一个统一宽度（中日韩字符按 13px、其他按 7.5px 估，再加左右内边距），
  // 短的留白、长的不换行。只在依赖图里用，顶部成员胶囊保持自然宽度。
  const estimateChipWidth = (name) => {
    let width = 0;
    for (const ch of String(name)) width += ch.codePointAt(0) > 0x2e80 ? 13 : 7.5;
    return width + 20;
  };
  const graphChipNames = new Set(['Lead']);
  for (const pair of pairs) {
    graphChipNames.add(pair.leftName);
    graphChipNames.add(pair.rightName);
  }
  const graphChipWidth = Math.ceil(Math.max(56, ...[...graphChipNames].map(estimateChipWidth)));
  const graphChipStyle = (color) => ({
    ...chipStyle(color),
    width: graphChipWidth,
    boxSizing: 'border-box',
    textAlign: 'center',
  });
  const pending = shown.filter((row) => row.delivered !== true).length;

  const togglePair = (key) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onLoadOlder = () => {
    if (typeof props.loadOlder !== 'function' || busy) return;
    setBusy(true);
    Promise.resolve(props.loadOlder()).then(
      () => setBusy(false),
      () => setBusy(false),
    );
  };

  // §5.48 — a fresh mount that sees nothing pages back on its own, once.
  // §5.50 — unless the host projection already answered: it folds the log from
  // its first event, so `hasMore` is false and there is nothing to page for.
  const teamSeen = folded.messages.length > 0 || folded.members.length > 0;
  const autoScan = React.useRef(false);
  const runScanRef = React.useRef(runScan);
  runScanRef.current = runScan;
  React.useEffect(() => {
    if (autoScan.current || teamSeen || canPage !== true || folded.hasMore !== true) return;
    autoScan.current = true;
    runScanRef.current(8);
  }, [canPage, folded.hasMore, teamSeen]);

  // §5.68 — 群聊页签「打开就在最上面」：宿主所有页签**共用同一根滚动条**（`scrollBody`），
  // 切页签不重置它，群聊于是在上次读到的位置打开（真机实测：对话滚到底后点群聊，仍停在 9328/34528）。
  // 这个视图每次显示都会重新挂载，所以在 layout effect 里、首帧绘制之前把宿主的滚动条拉回顶部：
  // 没有可见跳动，也不会跟正在阅读的人抢（挂载只发生一次，轮询重渲染不会触发）。
  const rootRef = React.useRef(null);
  React.useLayoutEffect(() => {
    const node = rootRef.current;
    if (node === null || node === undefined) return;
    resetHostScroll(node);
  }, []);
  if (folded.messages.length === 0 && folded.members.length === 0) {
    // §5.48 — an empty tab over a *truncated* window must not claim the session
    // never had a team: say where the records are and offer to walk back to them.
    const truncated = canPage === true && folded.hasMore === true;
    return h(TeamChatEmpty, { p: { truncated, scan, runScan } });
  }

  // 2026-10-16 拆文件：这一帧算出来的值打包成 `p` 交给四段渲染模块，
  // 每个模块内部再解构回原来的名字——搬过去的渲染代码一行没改。
  const p = {
    roster, shown, pending, folded, leadIds, colorOfRow, rosterChipStyle, onLoadOlder, busy,
    leadRows, cycleStart, cycleEnd, range, setRange, selectStyle, setFocusKey,
    pairs, inverted, expanded, togglePair, graphChipStyle, nameById,
    ordered, order, pickOrder, hoverKey, setHoverKey, fade, chipStyle,
  };

  return h(
    'div',
    { ref: rootRef, style: chatStyles.root },
    // §5.66 — 宿主 markdown 的容器带 `white-space: pre-wrap`（保留原文换行），它自己的段落
    // 又有 16px 上下外边距 —— 同一个空行被算两遍，实测块间距 56px。这里只把块级元素的外边距
    // 归零（`pre-wrap` 保留，单换行折行不受影响），块间距回到「一个空行 = 一行高」。
    // 用重复类名提高选择器权重，压过宿主 CSS module 的同权重规则。
    h('style', { key: 'atr-md-css' }, MARKDOWN_CSS),
    h(TeamChatStats, { p }),
    h(TeamChatGraph, { p }),
    h(TeamChatMessages, { p }),
  );
}
//#endregion

export { TeamChatView };
