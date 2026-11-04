// B1 / B2 —— 客户端 P0 真行为测试（批次B）。
//
// 假环境（vm 求值 lib/client.js + 极简 React 运行时 + 拦截 fetch）已抽到
// tests/client-runtime.mjs，与 p1-client.test.mjs 共用；本文件只剩这 7 条用例。
//
// 为什么不是源码正则断言：B1 的病根在 effect 的依赖数组（对象引用每次回包都变），
// B2 的病根在异步时序（失败提示先 setError、紧接着的 refresh 又 setError('')）。
// 正则断言只能证明「代码里写着某句话」，证明不了「用户看到的东西变了」。

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { BURST_WAIT_MS, mountPanel, role, secondRole, sleep, statePayload } from './support/client-runtime.mjs'

// ---------------------------------------------------------------------------
// B1 —— 编辑中的名字/描述/排序不能被任意 /state 回包抹掉
// ---------------------------------------------------------------------------

test('B1: 正在编辑的名字，不会被一次 /state 刷新抹掉', async () => {
  const panel = await mountPanel()
  try {
    assert.equal(panel.input('名字').props.value, '探查员', '初始应显示服务端的名字')

    panel.input('名字').props.onChange({ target: { value: 'PROBE-甲' } })
    await panel.settle()
    assert.equal(panel.input('名字').props.value, 'PROBE-甲', '本地编辑没有生效')

    // 服务端数据一个字都没变，只是把面板上「刷新」按了一下
    // （client.js:2197 → run({action:'reload'}) → 回包里的 state 再 adopt 一次）。
    await panel.reloadWith(statePayload())

    assert.equal(
      panel.input('名字').props.value,
      'PROBE-甲',
      '一次 /state 回包把用户正在编辑的名字抹掉了（client.js:1755-1766 的 effect 依赖了 selected 对象引用）',
    )
  } finally {
    panel.dispose()
  }
})

test('B1: 正在编辑的描述与排序，同样不会被 /state 刷新抹掉', async () => {
  const panel = await mountPanel()
  try {
    panel.input('描述').props.onChange({ target: { value: 'PROBE-描述' } })
    panel.input('排序（越小越靠前）').props.onChange({ target: { value: '9' } })
    await panel.settle()

    await panel.reloadWith(statePayload())

    assert.equal(panel.input('描述').props.value, 'PROBE-描述', '描述被 /state 回包抹掉了')
    assert.equal(panel.input('排序（越小越靠前）').props.value, '9', '排序被 /state 回包抹掉了')
  } finally {
    panel.dispose()
  }
})

test('B1: 正在编辑的角色 ID，不会被一次 /state 刷新抹掉', async () => {
  const panel = await mountPanel()
  try {
    // id 框显示的是**裸成员名**（role id `team-select` 去掉 `presetPrefix` `team-`）。
    assert.equal(panel.input('角色 ID（成员名）').props.value, 'select')

    panel.input('角色 ID（成员名）').props.onChange({ target: { value: 'probe-id' } })
    await panel.settle()
    assert.equal(panel.input('角色 ID（成员名）').props.value, 'probe-id', '本地编辑没有生效')

    await panel.reloadWith(statePayload())

    // 这个框的 onChange 被 tests/plugin/role-id.test.mjs:55 的源码形状断言锁着，改不了，
    // 所以 client.js 用「idDraft 偏离同步基线」来标 dirty：这里断言那条路径真的生效。
    //
    // 注意这次回包里**别的字段变了**（描述），同步 effect 的依赖确实变了、一定会重跑 ——
    // 否则「草稿还在」证明不了任何机制（服务端值一个都没变时 effect 压根不跑，
    // 突变检查就是这样骗过第一版的：把 dirty 机制整个拆掉这条用例照样绿）。
    await panel.reloadWith(statePayload([role({ description: '服务端改过的描述' }), secondRole()]))

    assert.equal(
      panel.input('角色 ID（成员名）').props.value,
      'probe-id',
      '一次 /state 回包把用户正在编辑的角色 ID 抹掉了',
    )
    // 逐字段 dirty 的第二个要求：没在编辑的字段必须照常跟服务端走。
    // 按角色记 dirty 的实现会在这里留下旧描述，接着「保存」就把旧值写回服务端。
    assert.equal(
      panel.input('描述').props.value,
      '服务端改过的描述',
      '只改了 ID，描述应该照常采纳服务端的新值（按角色记 dirty 会把它冻在旧值上）',
    )
  } finally {
    panel.dispose()
  }
})

test('B1: 没有未保存编辑时，服务端的新值仍然会被采纳', async () => {
  const panel = await mountPanel()
  try {
    assert.equal(panel.input('名字').props.value, '探查员')

    await panel.reloadWith(statePayload([role({ name: '探查员（改）' }), secondRole()]))

    assert.equal(panel.input('名字').props.value, '探查员（改）', '没在编辑时，服务端的新值应该照常采纳（不能靠"冻结输入框"来修 B1）')
  } finally {
    panel.dispose()
  }
})

test('B1: 切换角色后，编辑框显示目标角色的服务端值而不是上一个角色的草稿', async () => {
  const panel = await mountPanel()
  try {
    panel.input('名字').props.onChange({ target: { value: 'PROBE-甲的草稿' } })
    await panel.settle()

    // 角色行现在只有一行 `英文名(中文名)`（用户 m04536），点它 = 点这一行。
    await panel.click('devtest(开发测试)')
    assert.equal(panel.input('名字').props.value, '开发测试', '切到另一个角色后，编辑框应该显示这个角色的值')
  } finally {
    panel.dispose()
  }
})

// ---------------------------------------------------------------------------
// B2 —— 失败提示不能被紧接着的 refresh 抹掉
// ---------------------------------------------------------------------------

test('B2: /command 失败后，错误提示不会被随后自动执行的 refresh 抹掉', async () => {
  const panel = await mountPanel()
  try {
    panel.net.commandReply = () => {
      throw new Error('PROBE-FAIL-B2')
    }

    await panel.clickSwitchCheckbox()

    assert.ok(
      panel.text().includes('PROBE-FAIL-B2'),
      `失败后页面上应该能看到错误提示，实际渲染文本里没有。当前文本片段：${panel.text().slice(0, 400)}`,
    )
  } finally {
    panel.dispose()
  }
})

test('B2: 成功操作后错误提示会被正常清掉', async () => {
  const panel = await mountPanel()
  try {
    panel.net.commandReply = () => {
      throw new Error('PROBE-FAIL-B2')
    }
    const target = await panel.clickSwitchCheckbox()
    assert.ok(panel.text().includes('PROBE-FAIL-B2'), '失败后应该显示错误提示')

    // 同样的位置再来一次，这次让它成功。
    panel.net.commandReply = (body) => ({ state: statePayload(), action: body.action })
    const box = panel.checkboxes()[target.index]
    assert.ok(box, `第 ${target.index} 个复选框在重渲染后不见了`)
    box.props.onChange({ target: { checked: box.props.checked !== true } })
    await sleep(BURST_WAIT_MS)
    await panel.settle()

    assert.ok(!panel.text().includes('PROBE-FAIL-B2'), '操作成功后，旧的错误提示应该被清掉（不能变成永久性横幅）')
  } finally {
    panel.dispose()
  }
})
