/** 样式令牌纪律：颜色字面量只许出现在 src/client/tokens.js，别处写一个 npm test 直接红；
 * 设置区控件对齐官方那套（font: inherit + --dsw-* 边框/圆角令牌）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

import { T } from '../../src/client/tokens.js'

const SRC = new URL('../../src/client/', import.meta.url)
const BUNDLE = new URL('../../lib/client.js', import.meta.url)
const TOKENS = 'tokens.js'

/** 递归列出源文件（只用 fs，不依赖构建产物）。 */
async function sourceFiles(dir, prefix = '') {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = `${prefix}${entry.name}`
    if (entry.isDirectory()) out.push(...(await sourceFiles(new URL(`${entry.name}/`, dir), `${rel}/`)))
    else if (entry.name.endsWith('.js')) out.push(rel)
  }
  return out
}

/** 去掉注释：注释里解释「以前写的是 currentColor」不该被判违规。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

test('颜色字面量只允许出现在 tokens.js 里', async () => {
  const files = await sourceFiles(SRC)
  assert.ok(files.includes(TOKENS), '源文件清单里应该包含 tokens.js 自身')

  const offenders = []
  for (const file of files) {
    if (file === TOKENS) continue
    const code = stripComments(await readFile(new URL(file, SRC), 'utf8'))
    const hits = code.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|currentColor/g)
    if (hits !== null) offenders.push(`src/client/${file}: ${hits.join(', ')}`)
  }

  assert.deepEqual(offenders, [], `这些源文件又写死了颜色，请改用 tokens.js 的令牌/既定值：\n${offenders.join('\n')}`)
})

/** 字号阶梯：唯一来源是 tokens.js 的 FONT，别处只许写 F.md / T.font.xs。 */
test('字号字面量只允许出现在 tokens.js 里', async () => {
  const files = await sourceFiles(SRC)
  const offenders = []
  for (const file of files) {
    if (file === TOKENS) continue
    const code = stripComments(await readFile(new URL(file, SRC), 'utf8'))
    const hits = code.match(/fontSize: \d|font-size: \d/g)
    if (hits !== null) offenders.push(`src/client/${file}: ${hits.join(', ')}`)
  }
  assert.deepEqual(offenders, [], `字号请用 tokens.js 的阶梯（F.lg/md/sm/xs/xxs）：\n${offenders.join('\n')}`)

// 五档、单调、正文基准 13（面板根节点就是它，标题/输入框/二级字都对齐这档）。
  assert.deepEqual(T.font, { lg: 15, md: 13, sm: 12, xs: 11, xxs: 10 })
  assert.equal(T.field.fontSize, T.font.md, '输入框用正文基准那档')
  assert.equal(T.button.fontSize, T.font.sm, '按钮用辅助说明那档')
})

/** UI 范式：几何参数只有一处（tokens.js 的 T.layout），styles.js 里的行由 rowStyle(level) 生成，
 * 所以「二级行缩进 = 一个箭头宽」是算出来的；谁抄字面量、或把两级缩进写死成一样，测试直接红。 */
test('几何参数只有一处：行由 T.layout 生成，二级行比一级行多缩进一级', async () => {
  const { T: tokens } = await import('../../src/client/tokens.js')
  const { styles } = await import('../../src/client/styles.js')
  const L = tokens.layout
  assert.deepEqual(L, {
    gapLine: 8,
    gapBlock: 12,
    gapSection: 20,
    row: { gap: 8, padX: 6, padY: 4, headPadY: 5, indent: 16, toggle: 90 },
    item: { padX: 8, padY: 6 },
  })

// 行：两列网格 + 开关列宽来自范式；一级行和二级行只差左内边距（一个箭头宽）。
  const leftOf = (s) => s.padding.split(' ')[3]
  for (const [name, level] of [['line', 0], ['child', 1], ['lineStrong', 0], ['lineGroup', 0], ['panelHeader', 0]]) {
    const s = styles[name]
    assert.equal(s.gridTemplateColumns, `1fr ${L.row.toggle}px`, `${name} 的开关列宽要走范式`)
    const top = name === 'lineGroup' || name === 'panelHeader' ? L.row.headPadY : L.row.padY
    assert.equal(
      s.padding,
      `${top}px ${L.row.padX}px ${top}px ${L.row.padX + level * L.row.indent}px`,
      `${name} 的缩进/内边距要走范式`,
    )
  }
  assert.equal(
    Number.parseInt(leftOf(styles.child), 10) - Number.parseInt(leftOf(styles.line), 10),
    L.row.indent,
    '二级行 = 一级行 + 一个箭头宽（m11942）',
  )

// 三档间距：块间 > 块内 > 行内，且都来自范式。
  assert.equal(styles.page.gap, L.gapSection)
  assert.equal(styles.detail.gap, L.gapBlock)
  assert.equal(styles.field.gap, L.gapLine)
  assert.ok(L.gapSection > L.gapBlock && L.gapBlock > L.gapLine, '三档必须严格递减')
})

test('设置区的控件走官方令牌（字体继承是"字体毛躁"的根因）', () => {
// 官方输入框：0.5px 细边 + radius-md + 白底 + font: inherit。
  assert.equal(T.field.font, 'inherit', '原生 input 不继承字体，必须显式 font: inherit')
  assert.equal(T.field.height, 34)
  assert.ok(T.field.border.includes('var(--dsw-alias-border-l4)'), '边框要走官方 l4 那档')
  assert.equal(T.field.borderRadius, 'var(--dsw-radius-md)')
  assert.ok(T.field.background.includes('var(--dsw-alias-bg-layer-3)'), '底色走官方层 3')

// 令牌写成 var(--dsw-xxx)，关键的带 fallback（令牌缺失时浏览器会丢掉整条声明）。
  assert.match(T.border, /^var\(--dsw-alias-border-l4/)
  assert.match(T.borderSoft, /^var\(--dsw-alias-border-l2/)
  assert.match(T.error, /^var\(--dsw-alias-state-error-primary, /)
  assert.equal(T.button.font, 'inherit')
  assert.match(T.button.border, /^1px solid var\(--dsw-alias-border-l3/)
})

test('页签页跟底部输入框卡片同宽同位（用户 ）', async () => {
// 官方输入框卡片 = padding:0 var(--dsh-composer-side-clearance) + width:100%;max-width:var(--dsh-composer-card-max-width)。
// 本面板照抄这对声明（实测 clearance=16px、卡片上限=712px），于是两块盒子逐像素相同。
// 不许自己算 64%：那样参照的是 viewArea 而不是会话列，面板会宽出 89px。
  const { styles } = await import('../../src/client/styles.js')
  assert.match(styles.page.width, /calc\(100% - 2 \* var\(--dsh-composer-side-clearance/, '两侧留出与输入框同宽的间距')
  assert.equal(styles.page.margin, '0 auto', '居中：靠左会变成贴着左边一条')
  assert.match(styles.page.maxWidth, /^var\(--dsh-composer-card-max-width/, '上限直接用官方卡片变量，不许自己算')
  assert.equal(styles.page.padding, '16px 0 24px', '水平内边距必须为 0，否则内容比输入框窄一圈')
  assert.equal(styles.page.boxSizing, 'border-box')

// 两个入口（加载态 / 正式视图）都要套这层壳，少一个就会有一边被拉宽。
  for (const rel of ['section/team-roles.js', 'section/team-roles-view.js']) {
    const src = await readFile(new URL(`../../src/client/${rel}`, import.meta.url), 'utf8')
    assert.match(src, /style: styles\.page/, `${rel} 的根节点要用 styles.page`)
  }
})

test('横排里的控件要撑满面板上限宽度（用户 ）', async () => {
// styles.row 是横向 flex，子项默认不拉伸：只给 minWidth 的输入框会停在 180px，右边空出一大块。
// 口径只有一条——每一排都撑满上限宽度，横排里的输入框/下拉框一律用带 flex 的那两个样式。
  const { styles } = await import('../../src/client/styles.js')
  assert.equal(styles.inputGrow.flex, '1 1 180px', 'inputGrow 要吃掉横排剩余宽度')

// panels/mode.js 的下拉框也改成单独一行整宽（styles.select）：原来它跟那串路径挤在同一行。
  const rows = [
    ['panels/grouped-table.js', /style: styles\.inputGrow/],
    ['panels/mode.js', /style: styles\.select/],
  ]
  for (const [rel, pattern] of rows) {
    const src = await readFile(new URL(`../../src/client/${rel}`, import.meta.url), 'utf8')
    assert.match(src, pattern, `${rel} 的横排控件要撑满宽度`)
  }
})

test('构建产物里带着令牌与自绘箭头（源码之外还要真的发出去）', async () => {
  const bundle = await readFile(BUNDLE, 'utf8')
// 令牌名是模板拼出来的（var(--dsw-${name})），所以查的是那几个名字：库里搜得到，说明这层真被入口引到了。
  assert.ok(bundle.includes('alias-border-l4'), 'bundle 里应能搜到官方边框令牌名')
  assert.ok(bundle.includes('radius-md'), 'bundle 里应能搜到官方圆角令牌名')
  assert.ok(bundle.includes("font: 'inherit'"), 'bundle 里应能搜到 font: inherit')
  assert.ok(bundle.includes('data:image/svg+xml'), '下拉框自绘箭头应打进 bundle')
})
