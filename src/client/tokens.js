// 全插件唯一的样式定义处。
// 规则：除本文件外，src/client 源文件里不许出现颜色字面量（#rrggbb / rgba(...)），
// 也不许用 currentColor 当边框色 —— 由 tests/plugin/style-tokens.test.mjs 钉住。
// 角色色板（chat.palette）也收在这里：它是数据，但同样属于「颜色只在一个文件里定义」。
// 分两层：T = 官方设计令牌 --dsw-*（宿主 theme 注入）；chat = 群聊页既有冻结值。

// 声明一律写成普通 const/function，文件末尾一条 export { … } 列出对外符号（构建器只认这个子集）。

/** 取一个官方令牌。令牌缺失时浏览器会丢掉整条声明，所以关键的几个带 fallback。 */
const token = (name, fallback) => (fallback ? `var(--dsw-${name}, ${fallback})` : `var(--dsw-${name})`);

/** 字号阶梯 —— 全插件唯一的五个字号（15/13/12/11/10），语义按用途分
 *   lg = 15 统计数字那种要突出的
 *   md = 13 正文基准（根节点就是它，标题、输入框、二级字都对齐到这档）
 *   sm = 12 辅助说明、按钮、等宽代码块
 *   xs = 11 更小的注释（时间线、脚注）
 *   xxs = 10 徽标那种点缀
 * 数值变了语义不变。 */
const FONT = { lg: 15, md: 13, sm: 12, xs: 11, xxs: 10 };

/** 页面几何范式 —— 全插件唯一的间距 / 行参数。
 * 间距只有三档：8 组内 / 12 块内 / 20 块间。
 * 「行」是面板的基本单元：[内容 | 开关列] 两列网格，缩进按级算，
 * 一级正好一个 ▸ 的宽度（13px 系统字体实测 15.6px → 取 16），
 * 所以没有箭头的二级行文字与有箭头的标题文字起在同一条竖线上。 */
const LAYOUT = {
  gapLine: 8, // 行内：标签→输入框、同一组里相邻两行
  gapBlock: 12, // 块内：同一块里的字段之间
  gapSection: 20, // 块间：角色列表 / 设置 / 能力行 这些大块之间
  row: {
    gap: 8, // 行里两列之间的间距（内容 ↔ 右侧开关列）
    padX: 6, // 行左右内边距
    padY: 4, // 普通行上下内边距（相邻两行的文字间距 = gapLine，由这里的上下内边距凑出来）
    headPadY: 5, // 带底色的标题行上下内边距（比普通行多 1px）
    indent: 16, // 每缩进一级 = 一个 ▸ 箭头的宽度
    toggle: 90, // 右侧「整类 / 单个」开关列宽
  },
  // 「可点的一行」（角色列表那种），比能力行的行略胖。
  item: { padX: 8, padY: 6 },
};

const T = {
  // 文字
  labelPrimary: token('alias-label-primary'),
  labelSecondary: token('alias-label-secondary'),
  labelTertiary: token('alias-label-tertiary'),
  // 线（l1 最淡 → l4 最重：实测浅色主题为 5% / 10% / 12% / 16% 黑）
  border: token('alias-border-l4'), // 输入框那档
  borderSoft: token('alias-border-l2'), // 分隔线那档
  divider: token('alias-border-l3'),
  // 面
  fieldBg: token('alias-bg-layer-3'),
  chipBg: token('alias-bg-layer-2'),
  hoverBg: token('alias-interactive-bg-hover'),
  // 状态
  focusBorder: token('alias-state-business-primary'),
  error: token('alias-state-error-primary', '#f2645a'),
  // 圆角（官方四档：4 / 8 / 12 / 16）
  radiusXs: token('radius-xs'),
  radiusSm: token('radius-sm'),
  radiusMd: token('radius-md'),
  radiusLg: token('radius-lg'),
  fontFamily: token('font-family'),
  // 字号阶梯（见上）
  font: FONT,
  // 间距与行的几何范式（见上）
  layout: LAYOUT,
// 官方输入框那一套，逐条对齐 fields.module.css 的 .input。
// 重点是 font: inherit：原生 input / select / textarea 不继承字体，
// 这正是同一个面板里标签和输入框字号字重不一致的根因。
  field: {
    height: 34,
    padding: '0 12px',
    border: `0.5px solid ${token('alias-border-l4')}`,
    borderRadius: token('radius-md'),
    background: token('alias-bg-layer-3'),
    font: 'inherit',
    fontSize: FONT.md,
    lineHeight: 1.5,
    color: token('alias-label-primary'),
  },
  // 官方工具栏按钮那档：无填充、细边、圆角 sm。
  button: {
    border: `1px solid ${token('alias-border-l3')}`,
    background: 'transparent',
    color: 'inherit',
    borderRadius: token('radius-sm'),
    font: 'inherit',
    fontSize: FONT.sm,
    cursor: 'pointer',
  },
};

/** 自绘下拉框的箭头（内嵌 svg）：appearance:none 之后原生箭头会消失，靠这张图补回来。
 * 设置区与群聊共用同一个资产。 */
const caretImage =
  "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M1.5 3.75L5 7.25l3.5-3.5' fill='none' stroke='%23808080' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";

// 颜色与调色板的权威在宿主侧（lib/roleColor.js），随 /state 与角色一起下来。
// 下面这份只是回包前的兜底，以及角色表里没有的成员（手工起的名字）用的散列调色板，顺序与宿主侧一致。
const PALETTE = [
  '#1D4ED8',
  '#0F766E',
  '#B91C1C',
  '#C2410C',
  '#A21CAF',
  '#4338CA',
  '#15803D',
  '#0369A1',
  '#9D174D',
  '#4D7C0F',
];

/** 把 #rrggbb 按比例调淡（消息卡边框平时只到发送者色的 40%，悬停才转实色）。
 * 颜色字符串拼接也关在这一层，源文件里只调用；不是 #rrggbb 就原样返回。 */
function withAlpha(color, alpha) {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(String(color));
  if (hex === null) return color;
  const n = Number.parseInt(hex[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 群聊页既定值 —— UI 冻结：这些值一个字都不改，只搬个家。
 * 连 currentColor 这种跟着主题文字色走的写法也收在这里，源文件里不许再写。 */
const chat = {
  hairline: 'rgba(128,128,128,0.28)', // 统计项 / 下拉框的亮灰细边
  hairlineBorder: '1px solid rgba(128,128,128,0.28)',
  inheritBorder: '1px solid currentColor', // 排序按钮等跟着文字色走的那档
  separator: 'rgba(128,128,128,0.35)', // 时间线左侧竖线
  separatorLine: '2px solid rgba(128,128,128,0.35)',
  dashed: 'rgba(128,128,128,0.4)',
  dashedBorder: '1px dashed rgba(128,128,128,0.4)', // 空态虚线框
  hoverFill: 'rgba(128,128,128,0.25)', // 排序按钮选中底
  focusRing: 'rgba(128,128,128,0.6)', // 下拉框聚焦边
  caretImage,
  chipText: '#ffffff',
  purple: '#6B21A8', // 主题紫 = Lead 色
  palette: PALETTE,
  timePurple: '#c4b5fd',
  ok: '#4a9d6a',
  pending: '#e8a33d',
  failed: '#e05252',
};

export { T, chat, caretImage, withAlpha };
