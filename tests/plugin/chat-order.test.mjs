/** 群聊「消息流」排序 + 标题层级的源码形状断言（读构建产物 lib/client.js）。
 * 真机行为由 tools/accept-live.mjs 的 7 组断言覆盖（默认倒序 / 点击切换 / 记住选择 / 条数不变）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const BUNDLE = new URL('../../lib/client.js', import.meta.url)

test('消息流有 ↑/↓ 排序控件，默认倒序，并把选择记在本机', async () => {
  const source = await readFile(BUNDLE, 'utf8')

// 两个方向各一个按钮，当前生效的一侧由 aria-pressed 标出（无障碍与测试共用同一个真相）。
  assert.ok(source.includes("'↑ 正序'"), '缺 ↑ 正序 按钮')
  assert.ok(source.includes("'↓ 倒序'"), '缺 ↓ 倒序 按钮')
  assert.ok(source.includes("'aria-pressed': order === value"), '按钮要标出当前生效的一侧')
  assert.ok(source.includes("...(order === value ? chatStyles.orderOn : {})"), '选中态要视觉高亮')

// 默认倒序：只有明确记着 'asc' 才正序，其余（没记 / 读不到）都回到倒序。
  assert.ok(source.includes("=== 'asc' ? 'asc' : 'desc'"), '默认必须是倒序')
  assert.ok(source.includes("const newestFirst = order !== 'asc'"), '倒序判据')

// 选择记在本机；读写都要扛住 localStorage 不可用（隐私模式 / 非浏览器环境）。
  assert.ok(source.includes("'dsh-agent-team-roles:chat-order'"), '缺持久化键')
  assert.ok(source.includes('globalThis.localStorage?.getItem'), '读偏好要走 localStorage')
  assert.ok(source.includes('globalThis.localStorage?.setItem'), '写偏好要走 localStorage')
})

test('排序只改渲染顺序，不动统计 / @ 配对 / 翻页的口径', async () => {
  const source = await readFile(BUNDLE, 'utf8')

  assert.ok(source.includes('const ordered = newestFirst ? [...shown].reverse() : shown'), '倒序只在渲染前翻转副本')
  assert.ok(source.includes('ordered.map((row) => {'), '消息列表渲染的是 ordered')
// 统计与依赖图仍读时间正序的 shown：排序是显示层的事。
  assert.ok(source.includes('const pairs = foldPairs(shown, nameById)'), '@ 配对仍按 shown')
  assert.ok(source.includes('const pending = shown.filter((row) => row.delivered !== true).length'), '排队计数仍按 shown')
  assert.ok(source.includes('h(OrderSwitch, { order: order, onPick: pickOrder })'), '排序控件挂消息流标题行')
})

test('三处标题层级做强：统计行 / 成员 chip / 分区标题', async () => {
  const source = await readFile(BUNDLE, 'utf8')

// 分区标题：F.sm（12px）/600 + 中性灰，右侧接一条细线（分区起点的可见标记）。
// 字号一律走 tokens.js 的 T.font 阶梯，测试钉令牌而不是字面量。
  assert.match(source, /sectionTitle: \{ fontSize: F\.sm, fontWeight: 600/)
  assert.ok(source.includes('sectionBar: {'), '分区标题要有标题行（右侧放控件）')
  assert.ok(source.includes('sectionRule: {'), '分区标题要带一条延伸到右侧的细线')
  assert.ok(source.includes("h('span', { style: chatStyles.sectionTitle }, '角色依赖图')"))
// 依赖图标题行右侧不留细线（标题后面没有控件，留着是条没来由的横杠）。
  assert.doesNotMatch(
    source,
    /'角色依赖图'\),\s*h\('span', \{ style: chatStyles\.sectionRule \}\)/,
    '依赖图标题行不带右侧细线',
  )
// 顶部统计行：数字大（F.lg 15px/600 + 等宽数字）、标签小（F.xs 11px 淡灰），不再各自套小框。
  assert.match(source, /statValue: \{ fontSize: F\.lg, fontWeight: 600/)
  assert.match(source, /statLabel: \{ fontSize: F\.xs, opacity: 0\.6 \}/)
  assert.doesNotMatch(source, /stat: \{[\s\S]{0,200}border:/, '统计项不再各自套边框')
  assert.doesNotMatch(source, /header: \{[\s\S]{0,200}borderBottom/, '统计行不再用下边界分段')
// 卡片化之后分区标题行自带一条下边线（它是卡内分隔，不是原来那条通栏下划线）。
  assert.match(source, /sectionBar: \{[\s\S]{0,200}borderBottom/, '标题行在卡内以细线收口')
// 成员 chip 改为「色点 + 名字」，角色色只留在 6px 色点上，不再铺实底。
  assert.match(source, /nameChip: \{[\s\S]{0,260}fontWeight: 600/)
  assert.ok(source.includes('nameDot: { width: 8, height: 8'), '角色色收成一个空心细边小圆圈')
  assert.ok(source.includes('const rosterChipStyle = () => ({'), '成员名单复用名字 chip 的形状')
  assert.ok(
    source.includes('style: rosterChipStyle(color)'),
    '每个成员要用自己的角色色点',
  )
  assert.match(source, /orderOn: \{ opacity: 1, fontWeight: 600/)
})
