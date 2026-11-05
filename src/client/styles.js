// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 颜色 / 圆角 / 字体不写字面量：全部来自 tokens.js（官方 --dsw-* 令牌），由测试钉住。

import { T, caretImage } from './tokens.js';

// 字号与几何只从 tokens.js 取：F = 字号五档（15/13/12/11/10），L = 三档间距 + 行几何。
const F = T.font;
const L = T.layout;

/** 「行」的范式：[内容 | 开关列] 两列网格。
 * level = 缩进级数（1 = 二级行，缩进一个 ▸ 宽，与标题文字对齐）。
 * 要调整行高 / 缩进 / 开关列宽，只改 T.layout。 */
const rowStyle = (level = 0, extra = {}) => {
// padY 是唯一允许在范式默认值上覆盖的数字（带底色的标题行要 headPadY），
// 其余一律从 L.row 取，测试才能直接断言整条 padding 简写。
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

// 面板的壳：root 管纵向排布，page 再加页签页的宽度与位置。
// 宽度照抄官方输入框卡片那对变量（clearance 16px / 卡片上限 712px），两块盒子逐像素相同。
// 不许自己算 64%：参照系会变成 viewArea 而不是会话列，面板会宽出 89px、上下对不齐。
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
// 输入框统一走官方那一套（T.field：0.5px 细边 + radius-md + font: inherit）。
  input: { ...T.field, minWidth: 180 },
// 横排里的输入框：flex 吃掉剩余宽度，否则只剩 180px。
  inputGrow: { ...T.field, minWidth: 180, flex: '1 1 180px' },
// 下拉框：官方输入框的壳 + 自绘箭头（appearance:none 之后原生箭头会消失）。
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
// 「角色列表」一整块（一个角色一行）与「这个角色的全部设置」都撑满上限宽度。
// 不做左右两列：窗口一拉宽就并排、左列几个角色就结束、下面留一大块空白。
  columns: { display: 'flex', flexDirection: 'column', gap: L.gapSection },
  roles: { display: 'flex', flexDirection: 'column', gap: L.gapLine },
  roleItem: {
    textAlign: 'left',
    padding: `${L.item.padY}px ${L.item.padX}px`,
    borderRadius: T.radiusSm,
// 必须与 roleItemActive 同用长写属性：简写 + 只覆盖 borderColor 会让失去选中的那行留下黑框。
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'transparent',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: F.sm,
  },
  roleItemActive: { borderColor: T.border, background: T.chipBg },
// 这一整块纵向排、整宽。没有 flex: 1 1 420px：外壳纵向之后它变成「高度至少 420」。
  detail: { display: 'flex', flexDirection: 'column', gap: L.gapBlock },
  field: { display: 'flex', flexDirection: 'column', gap: L.gapLine },
// 字段标题统一一份，对齐官方 fields.module.css 的 .label（13px / 500 / 1.5 / label-primary）。
  label: { fontSize: F.md, fontWeight: 500, lineHeight: 1.5, color: T.labelPrimary },
// 标题 + ⓘ 同一行：挂在标签 span 自己身上，不包一层 div（夹具按 div > span + input 找输入框）。
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
// 列表 gap = gapLine - 2×padY：行与行文字的间距就是范式里的 gapLine。
  table: { display: 'flex', flexDirection: 'column', gap: L.gapLine - 2 * L.row.padY },
// 普通行 / 二级行（level:1）：二级行缩进一级，跟标题文字对齐。
  line: rowStyle(0),
  child: rowStyle(1),
// 分组行：普通行的底 + 灰底 + 加粗（能力行里「ego（33 个）」那些）。
  lineStrong: rowStyle(0, { fontWeight: 600 }),
// 带底色的标题行：跟分组行同宽同列，这样「整类 / 全部开关」的复选框正好在同一列。
  lineGroup: rowStyle(0, {
    padY: L.row.headPadY,
    background: T.chipBg,
    fontWeight: 600,
  }),
// MCP 那一行（McpPanel 的标题）与上面的分组行同一层，长得一样。
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
// 覆盖标记画真正的左边框，不用 boxShadow inset：行有 5px 圆角，内阴影会顺着圆角绕成「{」形。
// 左侧两个圆角压平，笔画才是直的。
  lineOverride: {
    borderLeft: `2px solid ${T.divider}`,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
  },
// 二级行的名字：字号 = 正文基准、不加粗、不用等宽字体
// （等宽在 Windows 会落到 Courier New，同 13px 也显得又小又细）。
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

export { styles };
