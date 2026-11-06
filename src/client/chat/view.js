// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 群聊 tab 视图：只负责取数、算派生值与装配，四段渲染在 chat/ 下的兄弟模块。

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
// 宿主对这条会话日志的投影：到得稍晚，也可能永远不到（运行时关着 / 会话不活跃），
// 那时 mergeTeamLog 原样交回本地窗口折出来的结果。
  const projection = useTeamProjection(props.sessionId);
  const folded = React.useMemo(() => mergeTeamLog(local, projection), [local, projection]);
  const [busy, setBusy] = React.useState(false);
  const [expanded, setExpanded] = React.useState(() => new Set());
  const [range, setRange] = React.useState(null);
  const [order, pickOrder] = useOrder();
// 角色颜色来自 /state 的角色表（角色自己 role.json 里那个 color）。
  const roleColors = useRoleColors();

// 外壳给的只是会话日志的**有界尾巴**，不是整段对话；
// 早前干过活的团队可能整个落在窗口之外，所以要靠宿主投影补回来。
  const loadOlderRef = React.useRef(props.loadOlder);
  loadOlderRef.current = props.loadOlder;
  const canPage = typeof props.loadOlder === 'function';
  const [scan, setScan] = React.useState({ running: false, rounds: 0, error: false });
  const runScan = (rounds) => {
    const load = loadOlderRef.current;
    if (typeof load !== 'function') return;
    setScan((current) => (current.running ? current : { running: true, rounds: current.rounds, error: false }));
// 记账口径 = 实际往前翻成功的段数：load() 返回 false 表示到顶，抛错表示这次读失败，
// 两种都不能按满 rounds 累加，否则「已经往前翻了 N 段」是假的。失败必须留下可见提示（scan.error）。
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

// team/member 记录是 TeamMemberSnapshot，不带 role 和 status：Lead 是 Team 根，TeamId 就是那个会话的 id。
  const leadId = folded.teamId === null ? props.sessionId : folded.teamId;
  const leadIds = new Set(leadId === null || leadId === undefined ? [] : [String(leadId)]);
  const nameById = new Map(folded.members.map((member) => [String(member.id), member.name]));
  for (const id of leadIds) if (nameById.has(id) !== true) nameById.set(id, 'lead');
// Lead 是 Team 根会话，日志里永远没有它的 team/member 记录，缺的时候合出一行。
  const roster =
    leadId === null || leadId === undefined || folded.members.some((m) => String(m.id) === String(leadId))
      ? folded.members
      : [{ id: leadId, name: 'lead', phase: 'active' }, ...folded.members];

// 颜色按「这个人是谁」取：Lead 固定深紫，其他角色用自己 role.json 里的颜色。
// 发送者、收件人、依赖图两端都用同一种 chip：只有颜色不同，不分主次。
  const colorOfRow = (id, name) =>
    leadIds.has(String(id)) ? roleColors.lead : roleColors.colorFor(id, name);
  const chipStyle = (color) => ({ ...chatStyles.nameChip, background: color, color: chat.chipText });
// 顶部成员名单用同一个 chip 形状，只是圆角更大（胶囊）。
  const rosterChipStyle = (color) => ({ ...chipStyle(color), borderRadius: 999, padding: '2px 10px' });
// 消息卡整圈边框平时只到发送者色的 40%（线太密不精致），鼠标移到这一条上才转实色；
// 依赖图行同理，平时无底色、悬停给极浅底色。调淡（含颜色字符串拼接）关在 tokens.js 里。
  const fade = withAlpha;
  const [hoverKey, setHoverKey] = React.useState(null);
// 下拉框自绘（appearance:none）之后没有原生焦点外观了，焦点自己用边框深浅表示（0.28 → 0.6）。
  const [focusKey, setFocusKey] = React.useState(null);
  const selectStyle = (key) =>
    focusKey === key ? { ...chatStyles.select, borderColor: chat.focusRing } : chatStyles.select;

// 默认周期 = 第一个 Lead @ → 最新一条消息，这样最后一条 @ 之后才到的成员回复不会被截掉。
// 两个 @ 选择器只能点名 Lead @ 点，「最新」因此是它自己的空选项值。
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
// 两个 @ 选择器互相独立，「起点晚于终点」可达；那一段确实为空，要明说，
// 而不是渲染成看起来整个会话都没消息的空白页签。
  const inverted = Number.isFinite(startSeq) && Number.isFinite(endSeq) && startSeq > endSeq;
  const shown = inverted ? [] : folded.messages.filter((row) => row.seq >= startSeq && row.seq <= endSeq);
// 只改渲染顺序：统计、@ 配对、翻页仍按时间正序处理 shown。
  const newestFirst = order !== 'asc';
  const ordered = newestFirst ? [...shown].reverse() : shown;
  const pairs = foldPairs(shown, nameById);
// 按这一屏出现过的角色名估一个统一宽度（中日韩按 13px、其他按 7.5px，再加左右内边距），
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

// 初次挂载什么都没看到时自动往前翻一次；宿主投影已经答过就不必翻
// （它从第一条事件折起，hasMore 是 false）。
  const teamSeen = folded.messages.length > 0 || folded.members.length > 0;
  const autoScan = React.useRef(false);
  const runScanRef = React.useRef(runScan);
  runScanRef.current = runScan;
  React.useEffect(() => {
    if (autoScan.current || teamSeen || canPage !== true || folded.hasMore !== true) return;
    autoScan.current = true;
    runScanRef.current(8);
  }, [canPage, folded.hasMore, teamSeen]);

// 群聊页签「打开就在最上面」：宿主所有页签共用同一根滚动条（scrollBody），切页签不重置它，
// 群聊于是停在上次读到的位置。本视图每次显示都重新挂载，所以在 layout effect 里、首帧绘制之前
// 把最近的可滚动祖先拉回顶部：没有可见跳动，也不跟正在阅读的人抢（挂载只发生一次）。
  const rootRef = React.useRef(null);
  React.useLayoutEffect(() => {
    const node = rootRef.current;
    if (node === null || node === undefined) return;
    resetHostScroll(node);
  }, []);
  if (folded.messages.length === 0 && folded.members.length === 0) {
// 窗口被截断时的空页签不能声称这个会话从没有过团队：要说清记录在哪，并提供往前翻。
    const truncated = canPage === true && folded.hasMore === true;
    return h(TeamChatEmpty, { p: { truncated, scan, runScan } });
  }

// 算出来的值打包成 p 交给四段渲染模块，各模块内部再解构回原名；搬过去的渲染代码不改。
  const p = {
    roster, shown, pending, folded, leadIds, colorOfRow, rosterChipStyle, onLoadOlder, busy,
    leadRows, cycleStart, cycleEnd, range, setRange, selectStyle, setFocusKey,
    pairs, inverted, expanded, togglePair, graphChipStyle, nameById,
    ordered, order, pickOrder, hoverKey, setHoverKey, fade, chipStyle,
  };

  return h(
    'div',
    { ref: rootRef, style: chatStyles.root },
// 宿主 markdown 容器带 white-space: pre-wrap，段落又有 16px 上下外边距，同一个空行被算两遍（实测块间距 56px）。
// 这里只把块级元素外边距归零（pre-wrap 保留，单换行折行不受影响），块间距回到「一个空行 = 一行高」。
// 用重复类名提高选择器权重，压过宿主 CSS module 的同权重规则。
    h('style', { key: 'atr-md-css' }, MARKDOWN_CSS),
    h(TeamChatStats, { p }),
    h(TeamChatGraph, { p }),
    h(TeamChatMessages, { p }),
  );
}
//#endregion

export { TeamChatView };
