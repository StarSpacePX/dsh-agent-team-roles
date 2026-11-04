// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 设置区样式 + 群聊 tab 样式（chatStyles）。
//
// 颜色/圆角/字体**一律不在这里写字面量**：全部来自 `tokens.js`（官方 `--dsw-*` 令牌
// 或群聊冻结值），由 `tests/plugin/style-tokens.test.mjs` 钉住。

import { T, chat, caretImage } from './tokens.js';

// 字号与几何都只从 tokens.js 取（用户 m11839 字号 / m11997 范式）：
// `F` = 字号五档（15/13/12/11/10），`L` = 三档间距 + 行几何，本文件不写这两类字面量。
const F = T.font;
const L = T.layout;

/** 「行」的范式：`[内容 | 开关列]` 两列网格。
 * `level` = 缩进级数（1 = 二级行，缩进一个 `▸` 宽，所以跟标题的**文字**对齐，用户 m11942）。
 * 要整体调行高/缩进/开关列宽，只改 `T.layout`。 */
const rowStyle = (level = 0, extra = {}) => {
  // `padY` 是唯一一个允许在范式默认值上覆盖的数字（带底色的标题行要 `headPadY`），
  // 其它一切从 `L.row` 取 —— 这样测试能直接断言整条 `padding` 简写。
  const { padY = L.row.padY, ...rest } = extra;
  return {
    display: 'grid',
    gridTemplateColumns: `1fr ${L.row.toggle}px`,
    gap: L.row.gap,
    alignItems: 'center',
    padding: `${padY}px ${L.row.padX}px ${padY}px ${L.row.padX + level * L.row.indent}px`,
    borderRadius: T.radiusSm,
    ...rest,
  };
};

// 面板的壳：`root` 管纵向排布，`page` 再加**页签页的宽度与位置**。
// 宽度口径 = 直接照抄官方输入框卡片的那对变量（实测 clearance 16px / 卡片上限 712px），两块盒子于是
// 逐像素相同。**不许自己算 64%**：参照系会变成 viewArea(1201) 而不是会话列(904)，面板宽出 89px
// （用户 m11586 的"上下对不齐"）。来龙去脉见 `Docs/UI范式.md`。
const rootBox = { display: 'flex', flexDirection: 'column', gap: L.gapSection, fontSize: F.md, color: 'inherit' };
const pageBox = {
  width: 'calc(100% - 2 * var(--dsh-composer-side-clearance, 16px))',
  maxWidth: 'var(--dsh-composer-card-max-width, 712px)',
  margin: '0 auto',
  padding: '16px 0 24px',
  boxSizing: 'border-box',
};

const styles = {
  root: { ...rootBox },
  page: { ...rootBox, ...pageBox },
  hint: { opacity: 0.7, fontSize: F.sm, lineHeight: 1.6 },
  row: { display: 'flex', gap: L.gapLine, alignItems: 'center', flexWrap: 'wrap' },
  button: {
    padding: '4px 10px',
    borderRadius: T.radiusSm,
    border: T.button.border,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: F.sm,
  },
  danger: { color: T.error },
  // 输入框统一走官方那一套（`T.field`：0.5px 细边 + radius-md + `font: inherit`）。
  input: { ...T.field, minWidth: 180 },
  // 横排里的输入框：`flex` 吃掉剩余宽度，否则只剩 180px（用户 m11525：「只有一个标准，撑满上限宽度」）。
  inputGrow: { ...T.field, minWidth: 180, flex: '1 1 180px' },
  // 下拉框：官方输入框的壳 + 自绘箭头（`appearance:none` 之后原生箭头会消失）。
  select: {
    ...T.field,
    appearance: 'none',
    WebkitAppearance: 'none',
    outline: 'none',
    paddingRight: 22,
    backgroundImage: caretImage,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 8px center',
    backgroundSize: '10px 10px',
    minWidth: 180,
  },
  // 上面「角色列表」一整块（**一个角色一行**）+ 下面「这个角色的全部设置」一整块，都撑满上限宽度。
  // 原来是左右两列：窗口一拉宽就并排、左列几个角色就结束、下面留一大块空白（m11695/m11698 否掉）。
  columns: { display: 'flex', flexDirection: 'column', gap: L.gapSection },
  roles: { display: 'flex', flexDirection: 'column', gap: L.gapLine },
  roleItem: {
    textAlign: 'left',
    padding: `${L.item.padY}px ${L.item.padX}px`,
    borderRadius: T.radiusSm,
    // 必须与 `roleItemActive` 同用长写属性：简写 + 只覆盖 borderColor 会让**失去选中**的那行留下黑框（m04207）。
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'transparent',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: F.sm,
  },
  roleItemActive: { borderColor: T.border, background: T.chipBg },
  // 下面这一整块（名字 / ID / 描述 / 排序 / 按钮 / 模式 / 目录 / 上下文 / 能力行）纵向排、整宽。
  // 没有 `flex: 1 1 420px`：外壳纵向之后它变成"高度至少 420"。
  detail: { display: 'flex', flexDirection: 'column', gap: L.gapBlock },
  field: { display: 'flex', flexDirection: 'column', gap: L.gapLine },
  // 字段标题统一一份，逐条对齐官方 `fields.module.css` 的 `.label`（13px / 500 / 1.5 / label-primary）。
  label: { fontSize: F.md, fontWeight: 500, lineHeight: 1.5, color: T.labelPrimary },
  // 标题 + ⓘ 同一行：挂在标签 span 自己身上，不再包一层 div（夹具按 `div > span + input` 找输入框）。
  labelInline: { display: 'inline-flex', alignItems: 'center', gap: 4 },
  // 层级标题：加粗 + 稍放大 + 一条分隔线，跟下面的字段拉开距离。
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '2px 0 5px',
    marginTop: 2,
    borderBottom: `1px solid ${T.borderSoft}`,
  },
  sectionTitle: { fontSize: F.md, fontWeight: 700, letterSpacing: '0.02em' },
  // 配置说明收进这个圆点：鼠标放上去（title）才展开。
  info: {
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 14,
    height: 14,
    borderRadius: '50%',
    border: `1px solid ${T.border}`,
    opacity: 0.55,
    fontSize: F.xxs,
    lineHeight: 1,
    fontStyle: 'italic',
    cursor: 'help',
    userSelect: 'none',
  },
  // 列表 gap = `gapLine` - 2×padY：行与行**文字**的间距就是范式里的 `gapLine`。
  table: { display: 'flex', flexDirection: 'column', gap: L.gapLine - 2 * L.row.padY },
  // 普通行 / 二级行（`level:1`）：二级行缩进一级，跟标题的**文字**对齐（用户 m11942）。
  line: rowStyle(0),
  child: rowStyle(1),
  // 分组行：普通行的底 + 灰色底 + 加粗（能力行里「ego（33 个）」「身份与规则（2）」那些）。
  lineStrong: rowStyle(0, { fontWeight: 600 }),
  // 带底色的标题行（「MCP 开关…」「技能（只挂勾选的 0 个）」「身份与规则（2）」）：
  // 跟分组行同宽同列，这样「整类/全部开关」的复选框正好在同一列上。
  lineGroup: rowStyle(0, {
    padY: L.row.headPadY,
    background: T.chipBg,
    fontWeight: 600,
  }),
  // MCP 那一行（`McpPanel` 的标题）和上面的分组行是同一层，长得一样。
  panelHeader: rowStyle(0, {
    padY: L.row.headPadY,
    background: T.chipBg,
    fontWeight: 600,
  }),
  groupToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    textAlign: 'left',
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
    fontWeight: 600,
  },
  // 用户 m19731：这一行的覆盖标记画真正的左边框，不是
  // `boxShadow: 'inset 2px 0 0 currentColor'` —— 行本身有 5px 圆角，
  // 内阴影会顺着圆角绕，屏幕上看起来是一个「{」形括号，不像竖线。
  // 左侧两个圆角压平，笔画才是直的（说明文字仍叫它「左侧竖线」，见 notes.js）。
  lineOverride: {
    borderLeft: `2px solid ${T.divider}`,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
  },
  // 二级行（`agentmemhub` / `acp_cache` …）的名字：字号 = 正文基准、不加粗、**不用等宽字体**
  // （等宽在 Windows 会落到 Courier New，同 13px 也显得又小又细，用户 m11900）。
  id: { fontSize: F.md },
  badge: { fontSize: F.xxs, opacity: 0.6, textAlign: 'right' },
  pre: {
    margin: 0,
    padding: 8,
    borderRadius: T.radiusSm,
    background: T.chipBg,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: F.xs,
    whiteSpace: 'pre-wrap',
    overflowX: 'auto',
  },
  textarea: {
    width: '100%',
    minHeight: 90,
    padding: 8,
    borderRadius: T.radiusMd,
    border: `0.5px solid ${T.border}`,
    background: T.fieldBg,
    color: 'inherit',
    font: 'inherit',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: F.sm,
  },
  error: { color: T.error, fontSize: F.sm, whiteSpace: 'pre-wrap' },
};

const chatStyles = {
  // 2026-10-13 减框改版（用户：「块的线条框框太多了，看起来不精致」）——间距只用三档：
  // 8（组内）/ 12（块内）/ 20（块间），圆角统一 8（胶囊除外）；线只用于分隔性质不同的东西。
  root: { display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 14px', fontSize: F.md, minHeight: 0, flex: 1 },
  // 顶部统计行：用户 2026-10-13 先要「整行加个亮灰框」，随即改成「每个统计项各自一个小框」——
  // 行本身不再有框，框移到 `stat`（2 成员 / 11 消息 / 8 任务 各一个），字号全程不动。
  header: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    alignItems: 'baseline',
    color: 'inherit',
  },
  // 单个统计项的小框：亮灰细边 + 8px 圆角，数字仍是 15px/600、标签 11px。
  stat: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 5,
    border: chat.hairlineBorder,
    borderRadius: 8,
    padding: '2px 8px',
  },
  statValue: { fontSize: F.lg, fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' },
  statLabel: { fontSize: F.xs, opacity: 0.6 },
  // 零散小注解（「历史未载完」「整份日志」）：最轻的一级，不抢眼。
  note: { fontSize: F.xs, opacity: 0.55 },
  roster: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  // 成员名单（用户 2026-10-13）：「顶上的角色状态也保持自己的属性颜色背景和白色字体」——
  // 这里不再有灰底样式，每个成员用自己的角色色 + 白字，形状复用 `nameChip`
  // （见 `chat/view.js` 的 `rosterChipStyle`）。
  list: { display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', minHeight: 0 },
  // 消息卡片的**整圈边框** = 发送者自己的角色色（用户 m00378：「框框和发送者的颜色一致」；
  // 用户 2026-10-13 澄清 m00727：「我说的是消息边框同色，不是卡片都改颜色」——所以只染边框，
  // 卡片底色与文字保持原样。颜色不写在这里：它在角色自己的 `role.json` 里，由
  // `chat/colors.js` 从 `/state` 取，渲染时 inline 上色；样式表只留形状。
  message: { border: '1px solid transparent', borderRadius: 8, padding: '8px 12px', transition: 'border-color 0.12s ease' },
  // 「谁 → 谁」这一行原来是整行 11px + opacity 0.7 的灰字，分不清谁发的。
  // 现在发送者与收件人共用同一种实底白字 chip：只用颜色区分角色，不分主次，
  // 时间与状态靠右（用户 m00378：「发送接收者不需要层级区分，只有颜色，这一行要显眼」）。
  meta: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    fontSize: F.xs,
    opacity: 1,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  nameChip: {
    fontWeight: 700,
    fontSize: F.sm,
    letterSpacing: '0.02em',
    color: chat.chipText,
    background: chat.purple,
    borderRadius: 6,
    padding: '1px 7px',
  },
  metaRight: { marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' },
  // 用户 2026-10-13：「时间是紫色…只是时间的紫色也淡一点」——时间固定淡紫、不再跟状态变色；
  // 送达状态保持自己的绿/橙/红（`ok` / `pending` / `failed`）。
  time: { color: chat.timePurple, fontVariantNumeric: 'tabular-nums' },
  body: { margin: 0, fontFamily: 'inherit', fontSize: F.sm, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  ok: { color: chat.ok },
  // 用户 2026-10-13：每一条的「发送成功 / 没成功」保持独立的绿 / 红，不受发送者深紫影响。
  pending: { color: chat.pending },
  failed: { color: chat.failed, fontWeight: 600 },
  // 分区标题（「角色依赖图」/「消息流」）保留用户 m00612 要的标题色（主题紫 = Lead 色），
  // 但 2026-10-13 减框改版去掉了通栏下划线：分段改为靠 20px 组间距 + 8px 标题下间距。
  sectionTitle: { fontSize: F.sm, fontWeight: 600, letterSpacing: '0.04em', color: chat.purple },
  // 标题行：标题在左，右侧放该区的控件（消息流的排序）。不再画分隔线。
  sectionBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
    paddingBottom: 8,
  },
  orderGroup: { display: 'flex', gap: 4, marginLeft: 'auto' },
  orderBtn: {
    padding: '1px 8px',
    borderRadius: 6,
    border: chat.inheritBorder,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: F.xs,
    opacity: 0.6,
  },
  // 当前生效的那一侧（默认倒序）实心高亮，一眼看出现在按哪种顺序读。
  orderOn: { opacity: 1, fontWeight: 700, background: chat.hoverFill },
  // 用户 2026-10-13：「@统计周期 去掉 @，把整行搞好看一点、大一点点」——整行当一条工具条：
  // 13px、控件加高加圆角；后来（同日）「去掉灰底，加个亮灰色框框」——填充改成描边。
  controls: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
    fontSize: F.md,
    fontWeight: 400,
    color: 'inherit',
    // 用户 2026-10-13：「第二行我框起来的去掉灰底，加个亮灰色框框」→ 再去掉外框，
    // 现在这一条只剩白底与两个下拉框，灰色全部下放到控件自身。
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
    padding: '6px 0',
  },
  // 短横线分隔符（<起始> - <结束>），用最轻的一级灰。
  controlLabel: { fontSize: F.sm, opacity: 0.6 },
  select: {
    font: 'inherit',
    fontSize: F.md,
    // 用户 2026-10-13：「点击再取消后框框不见了」→ 跟着宿主的做法走：关掉原生外观
    // （`appearance:none`）自己画箭头，边框永远由我们控制，浏览器那圈焦点外观不再插手。
    appearance: 'none',
    WebkitAppearance: 'none',
    outline: 'none',
    padding: '3px 22px 3px 8px',
    borderRadius: 6,
    // 用户 2026-10-13：「框框用亮灰色」+「里面的灰色也去掉」——白底 + 亮灰细边。
    // 长写三件套（不是 `border` 简写）：聚焦态（`chat/view.js:126`）只覆盖 `borderColor`，
    // 若这里是简写，失焦那一刻 React 会删掉 `borderColor` → 边框落回 currentColor（黑）。
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: chat.hairline,
    background: 'transparent',
    backgroundImage: chat.caretImage,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 6px center',
    backgroundSize: '10px 10px',
    color: 'inherit',
    maxWidth: 260,
  },
  graph: { display: 'flex', flexDirection: 'column', gap: 4 },
  // 依赖图行（2026-10-13 减框改版）：去掉每行描边，改成对齐的两列 + 等宽数字；
  // 用户又追加「两行不要背景灰色和悬浮背景灰」——常态与悬停都不上底色。
  graphRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    border: 'none',
    borderRadius: 8,
    padding: '5px 8px',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    lineHeight: '20px',
    textAlign: 'left',
    cursor: 'pointer',
  },
  arrow: { opacity: 0.45, fontSize: F.sm },
  // 展开行里的正文摘要（用户 m02211：显示完整标题、把这一行占满）——整行单行、行尾省略，
  // 全文挂在 `title` 上悬停可看。
  tlText: {
    flex: '1 1 auto',
    minWidth: 0,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  // 用户 2026-10-13：「直接把这个消息数放到角色中间显示」——去掉 `marginLeft: auto` 的右靠，
  // 数字就落在两个胶囊之间（跟着 `graphRow` 的 8px 间距走）。
  count: { fontSize: F.sm, opacity: 0.6, fontVariantNumeric: 'tabular-nums' },
  timeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    margin: '2px 0 6px 14px',
    paddingLeft: 10,
    borderLeft: chat.separatorLine,
  },
  tlRow: { display: 'flex', gap: 8, fontSize: F.xs, opacity: 0.9 },
  tlTime: { fontVariantNumeric: 'tabular-nums', opacity: 0.75, flex: '0 0 auto' },
  empty: { border: chat.dashedBorder, borderRadius: 8, padding: '14px', opacity: 0.85, lineHeight: 1.7 },
};


export { styles, chatStyles };
