/** 群聊与能力页的行为断言：把真的 lib/client.js 装进假宿主（假 React + 假 fetch）里跑，
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

// --- 群聊用的事件窗口夹具 ------------------------------------------------

const teamEvent = (seq, type, data, time = 1_700_000_000_000 + seq * 1000) => ({
  type: 'event',
  event: { type, seq, time, data },
})
const memberEvent = (seq, id, name, phase = 'active') => teamEvent(seq, 'team/member', { teamId: 'lead-1', member: { id, name, phase } })
const queuedEvent = (seq, id, senderId, senderName, targetId, text) =>
  teamEvent(seq, 'team/message/queued', {
    teamId: 'lead-1',
    message: { id, senderId, senderName, targetId, content: [{ type: 'text', text }] },
  })
const deliveredEvent = (seq, messageId) => teamEvent(seq, 'team/message/delivered', { teamId: 'lead-1', messageId })
const windowOf = (entries, extra = {}) => ({ entries, hasMore: false, ...extra })

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

// --- C1–C7：群聊 ----------------------------------------------------------
// 数据源两条：打开页面读一次宿主投影（`/team-log`：名册、任务板、磁盘账本），
// 以及各会话自己的 eventSource（宿主一追加就推）——实时那一半。

const relayEvent = (seq, senderId, targetId, text) => ({
  type: 'event',
  event: {
    type: 'agent/inbox/spliced',
    seq,
    time: 1_700_000_000_000 + seq * 1000,
    data: {
      target: 'next-step',
      inserted: [
        {
          role: 'user',
          content: [{ type: 'text', text: `Team message from ${senderId}:` }, { type: 'text', text }],
          source: { kind: 'agent-message', form: 'relay', senderSessionId: senderId },
        },
      ],
    },
  },
})

const messageOf = (id, senderId, senderName, targetId, targetName, text, time) => ({
  message: { id, senderId, senderName, targetId, targetName, content: [{ type: 'text', text }] },
  seq: time,
  time,
  delivered: true,
})

const projectionOf = ({ teamId = 'lead-1', members = [], tasks = [], messages = [] } = {}) => ({
  teamId,
  members,
  tasks,
  messages,
})

test('C1: 成员名单把合成的 Lead 行算进成员数，chip 只写名字与阶段', async () => {
  const projection = projectionOf({ members: [{ id: 'devtest', name: '开发测试', phase: 'active' }] })
  const panel = await mountPanel({ teamLogReply: () => projection })
  try {
    await panel.mountChat()
    await settleAsync(panel)
    const text = panel.text()
    assert.ok(text.includes('2 成员'), `成员数没算上合成的 Lead 行：${text}`)
// 用户 2026-11-09：「括号 lead 去掉」——名单里不再挂（Lead）标记，只留名字 · 阶段。
    assert.ok(text.includes('lead · active'), text)
    assert.ok(text.includes('开发测试 · active'), text)
  } finally {
    panel.dispose()
  }
})

test('C2: 两个方向折成一行「@N ⇄ @M」，展开行标题去掉开头空行', async () => {
  const projection = projectionOf({
    members: [{ id: 'devtest', name: '开发测试', phase: 'active' }],
    messages: [
      messageOf('m1', 'lead-1', 'lead', 'devtest', '开发测试', '第一件事', 1),
      messageOf('m2', 'lead-1', 'lead', 'devtest', '开发测试', '\n真实标题\n正文不该出现在标题里', 2),
      messageOf('m3', 'devtest', '开发测试', 'lead-1', 'lead', '收到', 3),
    ],
  })
  const panel = await mountPanel({ teamLogReply: () => projection })
  try {
    await panel.mountChat()
    await settleAsync(panel)
    assert.ok(panel.text().includes('@2 ⇄ @1'), `两个方向没折成一行：${panel.text()}`)
    const pair = buttonByTitle(panel.tree, 'lead → 开发测试 2 条；开发测试 → lead 1 条')
    assert.ok(pair, `依赖图那一行的 title 不对：${panel.text()}`)
    await clickNode(panel, pair)
    const title = findNode(
      panel.tree,
      (node) => node.type === 'span' && typeof node.props.title === 'string' && node.props.title.includes('正文不该出现在标题里')
    )
    assert.ok(title, '展开行没把完整正文挂在 title 上')
    assert.equal(title.children[0], '真实标题', `展开行第一行没去掉开头空行：${JSON.stringify(title.children[0])}`)
  } finally {
    panel.dispose()
  }
})

test('C3: 消息流默认倒序，点「↑ 正序」后记住这个选择', async () => {
  const store = new Map()
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
  }
  const projection = projectionOf({
    messages: [
      messageOf('m1', 'lead-1', 'lead', 'devtest', '开发测试', '较早', 1),
      messageOf('m2', 'lead-1', 'lead', 'devtest', '开发测试', '较晚', 2),
    ],
  })
  const panel = await mountPanel({ localStorage, teamLogReply: () => projection })
  try {
    await panel.mountChat()
    await settleAsync(panel)
    const desc = panel.text()
    assert.ok(desc.indexOf('较晚') < desc.indexOf('较早'), `默认应该是倒序：${desc}`)
    await clickNode(panel, buttonWith(panel.tree, '↑ 正序'))
    const asc = panel.text()
    assert.ok(asc.indexOf('较早') < asc.indexOf('较晚'), `切正序后顺序没变：${asc}`)
    assert.equal(store.get('dsh-agent-team-roles:chat-order'), 'asc', '选择没记在本机')
    await panel.mountChat()
    const again = panel.text()
    assert.ok(again.indexOf('较早') < again.indexOf('较晚'), '重新打开群聊没记住正序')
  } finally {
    panel.dispose()
  }
})

test('C4: 账本和名册都空时说「本会话还没有群聊记录」', async () => {
  const panel = await mountPanel({ teamLogReply: () => projectionOf() })
  try {
    await panel.mountChat()
    await settleAsync(panel)
    assert.ok(panel.text().includes('本会话还没有群聊记录。'), `空态没显示：${panel.text()}`)
  } finally {
    panel.dispose()
  }
})

test('C5: 宿主 markdown 渲染器永远拿到完整 labels，缺渲染器时退回纯文本', async () => {
  const seen = []
  const primitives = {
    MarkdownText: (props) => {
      seen.push(props)
      if (props.labels === undefined || props.labels === null || props.labels.code === undefined) {
        throw new TypeError("Cannot read properties of undefined (reading 'code')")
      }
      return { type: 'span', props: { 'data-md': props.text }, children: [props.text] }
    },
  }
  const projection = projectionOf({
    messages: [messageOf('m1', 'lead-1', 'lead', 'devtest', '开发测试', '正文一段', 1)],
  })
  let panel = await mountPanel({ primitives, teamLogReply: () => projection })
  try {
    await panel.mountChat()
    await settleAsync(panel)
    assert.ok(seen.length >= 1, '宿主渲染器一次都没被调用')
    const last = seen.at(-1)
    assert.equal(last.variant, 'body', '正文没按 body 变体渲染')
    assert.equal(last.text, '正文一段')
    assert.equal(last.labels.code.copyLabel, '复制', `labels 没补全：${JSON.stringify(last.labels)}`)
    assert.equal(last.labels.code.toolbarLabels.wrapLabel, '换行')
    const style = findNode(
      panel.tree,
      (node) => node.type === 'style' && typeof node.children[0] === 'string' && node.children[0].includes('.atr-chat-md')
    )
    assert.ok(style, '正文样式节点没了')
    assert.ok(style.children[0].includes('margin: 0'), '块级元素的外边距没归零（空行会被双计）')
  } finally {
    panel.dispose()
  }

  panel = await mountPanel({ teamLogReply: () => projection })
  try {
    await panel.mountChat()
    await settleAsync(panel)
    const pre = findNode(panel.tree, (node) => node.type === 'pre')
    assert.ok(pre, '没有宿主渲染器时应该退回 pre 纯文本')
    assert.equal(pre.children[0], '正文一段')
  } finally {
    panel.dispose()
  }
})

test('C6: 打开群聊时把宿主滚动容器拉回顶部，滚不动的容器不动', async () => {
  // 必须有内容才会渲染带 `ref: rootRef` 的根节点（空态那条 return 的根节点没有 ref）。
  const projection = projectionOf({ members: [{ id: 'devtest', name: '开发测试', phase: 'active' }] })
  const scroller = { overflowY: 'auto', scrollHeight: 1000, clientHeight: 100, scrollTop: 480 }
  const decorateHost = (node) => {
    if (node.props && node.props.ref !== undefined && node.props.ref !== null) node.parentElement = scroller
  }
  const computed = (el) => ({ overflowY: el.overflowY })
  let panel = await mountPanel({ decorateHost, getComputedStyle: computed, teamLogReply: () => projection })
  try {
    await panel.mountChat()
    await settleAsync(panel)
    assert.equal(scroller.scrollTop, 0, '打开群聊后宿主滚动条没回到顶部')
  } finally {
    panel.dispose()
  }

  const still = { overflowY: 'auto', scrollHeight: 100, clientHeight: 100, scrollTop: 480 }
  const decorateStill = (node) => {
    if (node.props && node.props.ref !== undefined && node.props.ref !== null) node.parentElement = still
  }
  panel = await mountPanel({ decorateHost: decorateStill, getComputedStyle: computed, teamLogReply: () => projection })
  try {
    await panel.mountChat()
    await settleAsync(panel)
    assert.equal(still.scrollTop, 480, '本来就滚不动的容器不该被碰')
  } finally {
    panel.dispose()
  }
})

test('C7: 账本里的历史与实时窗口里的新消息按 id 合并，不重复', async () => {
  const projection = projectionOf({
    messages: [messageOf('m1', 'lead-1', 'lead', 'devtest', '开发测试', '历史里的', 1)],
  })
  // 实时那一半：宿主机刚追加进本会话窗口的一条转达消息。
  const entries = [relayEvent(1, 'devtest', 'lead-1', '刚推过来的')]
  const panel = await mountPanel({ teamLogReply: () => projection, chat: { getWindow: () => windowOf(entries) } })
  try {
    await panel.mountChat()
    await settleAsync(panel)
    const text = panel.text()
    assert.ok(text.includes('历史里的'), `账本里的历史没显示：${text}`)
    assert.ok(text.includes('刚推过来的'), `实时窗口里的新消息没显示：${text}`)
    assert.equal(occurrences(text, '历史里的'), 1, `同一条消息出现了两次：${text}`)
    assert.ok(!text.includes('Team message from devtest:'), `转达抬头没剥掉：${text}`)
  } finally {
    panel.dispose()
  }
})
