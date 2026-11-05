// 客户端 P1 协议层真行为测试（E1 超时/重试/在途去重、E2 过期回包丢弃、E3 registered 兜底）。
// 病根全在时序与并发上，正则证明不了，所以把 lib/client.js 真装进 vm 求值、真渲染、真点、真拦截 fetch。
// 假环境在 tests/client-runtime.mjs。

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { deferred, mountPanel, role, secondRole, sleep, statePayload } from './support/client-runtime.mjs'

// ---- E1 —— 超时 / 重试 / 在途去重 ----

test('E1: 同一 action 在途时，重复点击不会重复发请求', async () => {
  const gate = deferred()
  const panel = await mountPanel({ commandReply: () => gate.promise })
  try {
    const run = (label) => {
      const node = panel.button(label)
      assert.ok(node, `没有找到「${label}」按钮`)
      node.props.onClick()
    }
// 连点两下「刷新」：React 还没来得及把按钮置灰，两次 onClick 落在同一帧里。
    run('刷新')
    run('刷新')
    await sleep(30)
    assert.equal(panel.net.commandCalls, 1, `同一 action 在途时应该只发一次，实际发了 ${panel.net.commandCalls} 次`)

    gate.resolve({ state: statePayload(), action: 'reload' })
    await sleep(30)
    await panel.settle()

// 在途结束之后下一次点击必须照常发出（去重只覆盖「在途」这一小段）。
    run('刷新')
    await sleep(30)
    assert.equal(panel.net.commandCalls, 2, '在途结束后应该重新发得出去')
  } finally {
    panel.dispose()
  }
})

test('E1: GET /state 超时会中止请求，而不是永远等下去', async () => {
  const panel = await mountPanel({ stateReply: () => new Promise(() => {}) })
  try {
    await sleep(700)
    assert.ok(panel.net.aborted >= 1, '超时没有触发 abort')
    assert.equal(panel.net.stateCalls, 3, `重试应停在 3 次，实际 ${panel.net.stateCalls} 次`)
    await panel.settle()
    assert.match(panel.text(), /PROBE-请求超时中止/, '超时失败没有变成可见的提示')
  } finally {
    panel.dispose()
  }
})

test('E1: 幂等 GET 遇 5xx 会有限重试，成功即返回', async () => {
  const panel = await mountPanel({
    stateReply: (call, scope) => (scope === 'chat-tab' || call >= 3
      ? statePayload()
      : { __reply: true, status: 503, payload: { error: 'PROBE-503' } }),
  })
  try {
    await sleep(700)
    await panel.settle()
    assert.equal(panel.net.stateCalls, 3, `503 应重试到第 3 次，实际 ${panel.net.stateCalls} 次`)
    assert.match(panel.text(), /探查员/, '重试成功后没有采纳回包')
  } finally {
    panel.dispose()
  }
})

test('E1: 幂等 GET 的 4xx 不重试', async () => {
  const panel = await mountPanel({
    stateReply: (call, scope) => (scope === 'chat-tab'
      ? statePayload()
      : { __reply: true, status: 400, payload: { error: 'PROBE-400' } }),
  })
  try {
    await sleep(900)
    assert.equal(panel.net.stateCalls, 1, `4xx 不该重试，实际 ${panel.net.stateCalls} 次`)
  } finally {
    panel.dispose()
  }
})

test('E1: 非幂等的 POST 失败后不重试', async () => {
  const panel = await mountPanel({ commandReply: () => { throw new Error('PROBE-命令失败') } })
  try {
    await panel.click('刷新')
    await sleep(120)
    assert.equal(panel.net.commandCalls, 1, `POST 不该重试，实际 ${panel.net.commandCalls} 次`)
  } finally {
    panel.dispose()
  }
})

test('E1: GET 重试到上限就放弃，并把失败变成可见提示', async () => {
  const panel = await mountPanel({
    stateReply: (call, scope) => (scope === 'chat-tab'
      ? statePayload()
      : { __reply: true, status: 503, payload: { error: 'PROBE-一直503' } }),
  })
  try {
    await sleep(1600)
    await panel.settle()
    assert.equal(panel.net.stateCalls, 3, `重试上限应是 3，实际 ${panel.net.stateCalls} 次`)
    assert.match(panel.text(), /PROBE-一直503/, '重试耗尽后没有提示')
  } finally {
    panel.dispose()
  }
})

// ---- E2 —— refresh 并发保护：后发覆盖先发，过期回包丢弃 ----

test('E2: refresh 的过期回包被丢弃（后发覆盖先发）', async () => {
  const stale = deferred()
  const A = statePayload([role({ name: 'A-甲' })])
  const FRESH = statePayload([role({ name: 'FRESH-丙' })])
  const STALE = statePayload([role({ name: 'STALE-乙' })])
  let held = false
  const panel = await mountPanel({
    state: A,
    compressTimers: false,
    stateReply: (call, scope) => {
      if (scope === 'chat-tab') return A
      if (call === 1) return A // 挂载时的第 1 次 refresh
// 第一次「命令失败之后的 refresh」挂住、故意晚回；之后每次 refresh 都立刻回 FRESH。
      if (!held) {
        held = true
        return stale.promise
      }
      return FRESH
    },
    commandReply: () => { throw new Error('E2-FAIL-丁') },
  })
  try {
    assert.match(panel.text(), /A-甲/, '初始状态没渲染出来')

    const index = await panel.findSwitchIndex()
    assert.notEqual(index, null, '面板里没有找到会发 set-switches 的复选框，用例前提不成立')

    // 第 1 次：命令失败 → catch 里 await refresh()（第 2 次 /state，挂住）
    await panel.clickSwitch(index)
    // 第 2 次：命令再失败 → 又一个 refresh()（第 3 次 /state，先到并 adopt）
    await panel.clickSwitch(index)
    assert.match(
      panel.text(),
      /FRESH-丙/,
      `后发的 refresh 结果没有被采纳（panel /state 次数=${panel.net.stateCalls}，命令=${panel.net.commandCalls}，动作=${panel.net.commands.map((item) => item && item.action).join(',')}）`,
    )

    // 现在把"先发但晚到"的那份回包放出来：它必须被丢掉。
    stale.resolve(STALE)
    await sleep(40)
    await panel.settle()
    assert.match(panel.text(), /FRESH-丙/, '过期回包把新结果盖掉了（E2 未修）')
    assert.doesNotMatch(panel.text(), /STALE-乙/, '过期回包的内容出现在了面板上')
  } finally {
    panel.dispose()
  }
})

// ---- E3 —— state.registered 兜底 ----

test('E3: state.registered 缺失时面板照常渲染，且不误报「未注册」', async () => {
  const panel = await mountPanel({ state: statePayload([role(), secondRole()], { registered: undefined }) })
  try {
    assert.match(panel.text(), /探查员/, 'registered 缺失时面板没渲染出来（白屏）')
    assert.match(panel.text(), /开发测试/, '角色列表没渲染出来')
    assert.equal(panel.input('名字').props.value, '探查员', '详情区没有渲染出来')
    assert.doesNotMatch(panel.text(), /未注册/, 'registered 缺席时不该断言「未注册」')
  } finally {
    panel.dispose()
  }
})

test('E3: registered 是 null / 对象时同样不炸；是空数组时仍然如实报「未注册」', async () => {
  const nullPanel = await mountPanel({ state: statePayload([role()], { registered: null }) })
  try {
    assert.match(nullPanel.text(), /探查员/, 'registered=null 时面板没渲染出来')
    assert.doesNotMatch(nullPanel.text(), /未注册/, 'registered=null 时不该断言「未注册」')
  } finally {
    nullPanel.dispose()
  }

  const objectPanel = await mountPanel({ state: statePayload([role()], { registered: { 'team-select': true } }) })
  try {
    assert.match(objectPanel.text(), /探查员/, 'registered 是对象时面板没渲染出来')
    assert.doesNotMatch(objectPanel.text(), /未注册/, 'registered 形状不对时不该断言「未注册」')
  } finally {
    objectPanel.dispose()
  }

  const emptyPanel = await mountPanel({ state: statePayload([role()], { registered: [] }) })
  try {
    assert.match(emptyPanel.text(), /未注册/, 'registered 是空数组（宿主明确说没人注册）时应该如实报「未注册」')
  } finally {
    emptyPanel.dispose()
  }
})
