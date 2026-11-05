/** 能力页的行为断言：把真的 lib/client.js 装进假宿主（假 React + 假 fetch）里跑，
 * 只断言渲染出来的东西和真发出去的请求。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BURST_WAIT_MS, mountPanel, role, row, sleep, statePayload, walk } from '../support/client-runtime.mjs'

// --- 树查询：只按渲染结果找节点，不碰客户端源码 -----------------------------

const findNode = (tree, predicate) => {
  let hit = null
  walk(tree, (node) => {
    if (hit === null && predicate(node)) hit = node
  })
  return hit
}

const hasText = (node, text) => node.children.some((child) => typeof child === 'string' && child.includes(text))
const buttonWith = (tree, text) => findNode(tree, (node) => node.type === 'button' && hasText(node, text))
const buttonByTitle = (tree, title) => findNode(tree, (node) => node.type === 'button' && node.props.title === title)
const checkboxByTitle = (tree, title) =>
  findNode(tree, (node) => node.type === 'input' && node.props.type === 'checkbox' && node.props.title === title)
const filterBox = (tree) =>
  findNode(tree, (node) => node.type === 'input' && typeof node.props.placeholder === 'string' && node.props.placeholder.startsWith('过滤：'))
const occurrences = (hay, needle) => hay.split(needle).length - 1

const clickNode = async (panel, node) => {
  assert.ok(node, '要点的按钮不在渲染树里')
  assert.notEqual(node.props.disabled, true, '按钮是禁用的')
  node.props.onClick()
  await panel.settle()
}

/** 等异步链（轮询 / 翻页 / 投影回包）真的落地：微任务轮 + 若干轮渲染。 */
const settleAsync = async (panel) => {
  for (let round = 0; round < 5; round += 1) {
    await sleep(0)
    await panel.settle()
  }
}

// --- S1–S4：能力页 ---------------------------------------------------------

test('S1: 能力页按 MCP → 插件 → 技能 铺开三块', async () => {
  const panel = await mountPanel()
  try {
    const text = panel.text()
    const at = ['MCP 开关', '插件（部署里有 1 个可禁用的工具）', '技能（'].map((label) => text.indexOf(label))
    assert.ok(
      at.every((index) => index > -1),
      `三块没都渲染出来：${text.slice(0, 300)}`
    )
    assert.ok(at[0] < at[1] && at[1] < at[2], `三块顺序不对：${at.join(' / ')}`)
  } finally {
    panel.dispose()
  }
})

test('S2: 过滤框让汇总计数和「显示 N / 共 M」跟着一起变', async () => {
  // 3 行（tool 类 2 行）+ MCP 2 个 + 工具 1 个 + 技能 1 个 = 汇总 7 行。
  const rows = [row('needle-a', 'tool', '工具甲'), row('needle-b', 'tool', '工具乙'), row('needle-c', 'agents-md', '文档丙')]
  const state = statePayload([role({ rows })])
  const panel = await mountPanel({ state, commandReply: (body) => ({ state, action: body.action }) })
  try {
    assert.ok(panel.text().includes('共 7 行 · 显示 7'), panel.text().slice(-300))
    const box = filterBox(panel.tree)
    assert.ok(box, '没找到过滤框')
    box.props.onChange({ target: { value: 'needle-a' } })
    await panel.settle()
    const text = panel.text()
    assert.ok(text.includes('共 7 行 · 显示 1'), `汇总没跟着过滤走：${text.slice(-300)}`)
    assert.ok(text.includes('（显示 1 / 共 2）'), `分类徽标没写「显示 1 / 共 2」：${text.slice(-300)}`)
    box.props.onChange({ target: { value: '' } })
    await panel.settle()
    assert.ok(!panel.text().includes('（显示 '), '清掉过滤后不该再有「显示 N / 共 M」')
  } finally {
    panel.dispose()
  }
})

test('S3: 同前缀 ≥3 的工具叠成一组，组头一下开关整组、写的是精确工具名', async () => {
  const base = statePayload([role()])
  const tools = ['ego_click', 'ego_hover', 'ego_wait', 'other_tool'].map((name) => ({ name, description: `${name} 说明` }))
  const state = { ...base, toolGate: { error: null, tools } }
  const panel = await mountPanel({ state, commandReply: (body) => ({ state, action: body.action }) })
  try {
    await clickNode(panel, buttonWith(panel.tree, '插件（部署里有 4 个可禁用的工具）'))
    assert.ok(panel.text().includes('ego（3 个）'), `没把 3 个同前缀工具叠成一组：${panel.text().slice(-300)}`)
    assert.ok(!panel.text().includes('ego_click'), '组默认收起，成员行不该平铺出来')
    await clickNode(panel, buttonByTitle(panel.tree, '展开这一组'))
    assert.ok(panel.text().includes('ego_click'), '展开组后成员行没出来')
    const groupBox = checkboxByTitle(panel.tree, '整组都关掉')
    assert.ok(groupBox, '组头没有「整组都关掉」的勾选框')
    groupBox.props.onChange({ target: { checked: false } })
    await sleep(BURST_WAIT_MS)
    await panel.settle()
    assert.ok(panel.net.commandCalls >= 1, '组开关没发出任何 /command')
    const sent = JSON.stringify(panel.net.commands.at(-1))
    for (const name of ['ego_click', 'ego_hover', 'ego_wait']) {
      assert.ok(sent.includes(name), `组开关漏了 ${name}：${sent}`)
    }
    assert.ok(!sent.includes('other_tool'), `组开关串到别的工具上了：${sent}`)
  } finally {
    panel.dispose()
  }
})

test('S4: 点一个技能只灰它自己那一行，连点合并成一条 set-skills', async () => {
  const base = statePayload([role()])
  const available = ['skill-a', 'skill-b', 'skill-c'].map((name) => ({
    name,
    description: `${name} 的说明`,
    label: name,
    kind: 'skill',
    dir: `C:\\fake\\skills\\${name}`,
    file: `C:\\fake\\skills\\${name}\\SKILL.md`,
    root: 'builtin',
    rootLabel: '内置',
  }))
  const state = { ...base, skills: { ...base.skills, available } }
  const panel = await mountPanel({ state, commandReply: (body) => ({ state, action: body.action }) })
  try {
    await clickNode(panel, buttonWith(panel.tree, '技能（只挂勾选的 0 个）'))
    const boxA = checkboxByTitle(panel.tree, 'skill-a 的说明')
    assert.ok(boxA, '技能行没渲染出来')
    boxA.props.onChange({ target: { checked: true } })
    await panel.settle()
    assert.equal(checkboxByTitle(panel.tree, 'skill-a 的说明').props.disabled, true, '被点的这一行应该自己变灰')
    assert.notEqual(checkboxByTitle(panel.tree, 'skill-b 的说明').props.disabled, true, '没点的行不该跟着灰')
    // 真机上两次点击之间必然有一次重渲染（勾选状态从 draft 回来），这里补上，
    // 否则第三次点击拿到的还是第一帧的 chosen，合并出来的名单会漏掉中间那个。
    checkboxByTitle(panel.tree, 'skill-b 的说明').props.onChange({ target: { checked: true } })
    await panel.settle()
    checkboxByTitle(panel.tree, 'skill-c 的说明').props.onChange({ target: { checked: true } })
    await sleep(BURST_WAIT_MS)
    await panel.settle()
    assert.equal(panel.net.commandCalls, 1, `连点应该合并成一条：${JSON.stringify(panel.net.commands)}`)
    const sent = JSON.stringify(panel.net.commands[0])
    for (const name of ['skill-a', 'skill-b', 'skill-c']) {
      assert.ok(sent.includes(name), `合并后的请求漏了 ${name}：${sent}`)
    }
  } finally {
    panel.dispose()
  }
})

