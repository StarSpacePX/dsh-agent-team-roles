// 全插件**唯一**的样式定义处。
//
// 规则：除了本文件，任何 src/client 源文件里都不许再出现颜色字面量
// （`#rrggbb` / `rgba(...)`），也不许用 `currentColor` 当边框色——
// 由 `tests/plugin/style-tokens.test.mjs` 钉住。角色色板（`chat.palette`）也收在这里：
// 它是**数据**（宿主 `lib/roleColor.js` 的下发兜底），但同样属于"颜色只在一个文件里定义"。
//
// 分两层：
//  1. `T`    —— 官方设计令牌 `--dsw-*`。这些变量由宿主
//     `@deepseek-ai/dsh-client-ui-theme` 注入（`lib/client.js` 的
//     `design_platform_css_default`，共 400+ 个），深浅主题自动跟随；
//     官方组件自己也只用这些变量（例：`dsh-client-ui-primitives` 的
//     `lib/settings-form/fields.module.css` 里的 `.input`）。设置页与新代码只用这一层。
//  2. `chat` —— 群聊页的既定值：用户逐轮定稿，**值不许动**（UI 冻结），
//     只是从散落的写法收口到这里，方便一步改全套。

// 声明一律写成普通 const/function，文件末尾一条 `export { … }` 列出对外符号
// （构建器只认这个子集，见 `tools/build-client.mjs:9-15`）。

/** 取一个官方令牌。令牌缺失时浏览器会丢掉整条声明，所以关键的几个带 fallback。 */
const token = (name, fallback) => (fallback ? `var(--dsw-${name}, ${fallback})` : `var(--dsw-${name})`);

/**
 * 字号阶梯 —— **全插件唯一的五个字号**（用户 m11839「字也统一参数」）。
 *
 * 之前 10/11/12/13/15 散在 styles.js 的几十个 style 键里，想整体放大放小要一个一个改。
 * 现在只有这一处定义，`styles.js` 里写 `F.md`，群聊写 `T.font.xs`。
 * 语义按用途分（不按数值），这样数值变了语义不变：
 *   lg = 15 统计数字那种要突出的
 *   md = 13 **正文基准**（根节点就是它，标题、输入框、二级字都对齐到这档）
 *   sm = 12 辅助说明、按钮、等宽代码块
 *   xs = 11 更小的注释（时间线、脚注）
 *   xxs = 10 徽标那种点缀
 */
const FONT = { lg: 15, md: 13, sm: 12, xs: 11, xxs: 10 };

/**
 * 页面几何范式 —— 全插件唯一的「间距 / 行」参数（用户 m11997：「一个页面的 UI 范式，
 * 就不能统一一下参数，老是改一堆」）。
 *
 * 间距**只有三档**，和群聊页早就定下的那套一致（见 styles.js 的 chatStyles 注释：
 * 8 组内 / 12 块内 / 20 块间）。设置页原来是 14/10/6/4/2/16 各写各的，现在并成同一套。
 *
 * 「行」是这个面板的基本单元：一行 = `[内容 | 开关列]` 两列网格，缩进按**级**算，
 * 一级正好一个 `▸` 箭头的宽度（13px 系统字体实测 15.6px → 取 16），
 * 所以「没有箭头的二级行」的文字和「有箭头的标题」的文字起在同一条竖线上（用户 m11942）。
 */
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
  // 官方输入框那一套，逐条对齐 `dsh-client-ui-primitives/lib/settings-form/fields.module.css` 的 `.input`。
  // 重点是 `font: inherit`：原生 input/select/textarea 不继承字体，
  // 这正是之前"字体毛躁"（同一个面板里标签和输入框字号字重不一致）的根因。
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

/**
 * 自绘下拉框的箭头（内嵌 svg）：`appearance:none` 之后原生箭头会消失，
 * 靠这张图补回来。设置区与群聊共用同一个资产。
 */
const caretImage =
  "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M1.5 3.75L5 7.25l3.5-3.5' fill='none' stroke='%23808080' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";

// 颜色和调色板的权威来源是宿主半（`lib/roleColor.js`），`/state` 里随角色一起下来
// （`roles[].color` / `rolePalette` / `leadColor`）。下面这份只是拿到回包之前的兜底，
// 以及角色表里没有的成员（比如手工起的名字）用的散列调色板，顺序与宿主半一致。
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

/**
 * 把 `#rrggbb` 按比例调淡（消息卡边框平时只到发送者色的 40%，悬停才转实色）——
 * 颜色字符串的拼接也关在这一层，源文件里只调用。不是 `#rrggbb` 就原样返回。
 */
function withAlpha(color, alpha) {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(String(color));
  if (hex === null) return color;
  const n = Number.parseInt(hex[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * 群聊页既定值 —— **UI 冻结**：这些值一个字都不改，只搬个家。
 * 连 `currentColor` 这种"跟着主题文字色走"的写法也收在这里，源文件里不许再写。
 */
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
