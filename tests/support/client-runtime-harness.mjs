// 共享的浏览器端测试运行时 —— p0-client.test.mjs 与 p1-client.test.mjs 共用。
//
// 为什么是行为测试而不是源码正则断言：B1 的病根在 effect 的依赖数组（对象引用
// 每次回包都变），B2 在异步时序，E1/E2/E3 在超时、并发与缺字段兜底。正则断言只
// 能证明「代码里写着某句话」，证明不了「用户看到的东西变了」。所以这里把
// lib/client.js 真的装进 vm 求值，用一个极简 React 运行时真渲染面板、真改输入框、
// 真点按钮、真拦截 fetch。
//
// 这一份是从两个测试文件里合并出来的：它们曾各自抄了一份 createRuntime / walk /
// textOf / row / role / secondRole / statePayload / mountPanel，非空行有 481 行
// 逐字相同。合并以 p1 的版本为超集（多了定时器压缩、AbortController、scope 计数），
// 再把 p0 独有的 probeSwitchCheckbox / clickSwitchCheckbox / reloadWith 一并挂到 panel 上。
//
// 夹具是手写的合成数据，字段名逐个对齐 3099 真机 /state 回包（见
// Docs/teams 下的运行时实测与批次实施记录），不含任何本机路径。

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_FILE = path.resolve(HERE, '..', '..', 'lib', 'client.js')
import { sleep, BURST_WAIT_MS, LONG_TIMER_THRESHOLD_MS, LONG_TIMER_FAKE_MS, abortFailure, createRuntime } from './client-runtime-host.mjs'
import { walk, textOf, statePayload, jsonReply } from './client-runtime-fixtures.mjs'

export async function mountPanel(options = {}) {
  const runtime = createRuntime({ decorateHost: options.decorateHost })
  let entry = null

  const net = {
    state: options.state === undefined ? statePayload() : options.state,
    stateCalls: 0,
    commandCalls: 0,
    commands: [],
    aborted: 0,
    // 「群聊」tab 在 apply 时就会自己读一次 /state（client.js:3488）。它是插件挂载
    // 期间的请求，跟面板渲染无关，所以按 scope 分开计数：用例只断言 panel 那一份。
    scopeCalls: { 'chat-tab': 0, panel: 0 },
    // stateReply / commandReply 给用例改：返回 payload，或抛错。
    stateReply: options.stateReply || null,
    commandReply: options.commandReply || null,
  }

  const sandbox = {
    console,
    // §E1 的请求超时是 15s —— 测试把 ≥10s 的延时压成 5ms，其余（burst 120ms、
    // ERROR_TTL_MS 8000）原样，这样「超时中止」是真的被 AbortController 触发的。
    // E2 那种「故意挂住、晚点再回」的用例要关掉压缩（`compressTimers: false`），
    // 否则挂住的那条请求会在 5ms 后被超时中止，根本走不到「晚回但成功」那条路。
    setTimeout: (fn, ms, ...rest) => setTimeout(
      fn,
      options.compressTimers === false
        ? ms
        : (typeof ms === 'number' && ms >= LONG_TIMER_THRESHOLD_MS ? LONG_TIMER_FAKE_MS : ms),
      ...rest,
    ),
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    AbortController,
    fetch: async (url, init = {}) => {
      const target = String(url)
      // signal 被 abort 时，真实 fetch 会以 AbortError 拒绝 —— 这里照做。
      const abortWatch = new Promise((_resolve, reject) => {
        const signal = init.signal
        if (!signal) return
        if (signal.aborted) {
          net.aborted += 1
          reject(abortFailure())
          return
        }
        signal.addEventListener('abort', () => {
          net.aborted += 1
          reject(abortFailure())
        })
      })
      if (target.includes('/api/dsh-agent-team-roles/state')) {
        net.stateCalls += 1
        // 第 1 次 /state 是「群聊」tab 在 apply 时自己发的（client.js:3488），跟面板
        // 的刷新链无关：这里直接让它一次成功，免得它的超时/重试混进面板的计数里。
        const isChatTab = net.stateCalls === 1
        const scope = isChatTab ? 'chat-tab' : 'panel'
        net.scopeCalls[scope] += 1
        const call = net.scopeCalls[scope]
        return Promise.race([
          (async () => {
            if (isChatTab) return jsonReply(statePayload())
            const produced = net.stateReply ? await net.stateReply(call, scope) : net.state
            if (produced && produced.__reply === true) return jsonReply(produced.payload, produced.status)
            return jsonReply(produced)
          })(),
          abortWatch,
        ])
      }
      if (target.includes('/api/dsh-agent-team-roles/command')) {
        net.commandCalls += 1
        const body = init.body ? JSON.parse(init.body) : null
        net.commands.push(body)
        return Promise.race([
          (async () => {
            if (net.commandReply) return jsonReply(await net.commandReply(body))
            throw new Error(`client-runtime: 用例没有设置 commandReply，却发了 ${JSON.stringify(body)}`)
          })(),
          abortWatch,
        ])
      }
      if (target.includes('/api/dsh-agent-team-roles/team-log')) {
        // 群聊视图每 TEAM_LOG_POLL_MS(4000) 拉一次宿主投影；默认回一份「读不到」，
        // 视图就退回本地事件窗口（§5.50）。用例要测合并时给 teamLogReply。
        const produced = options.teamLogReply ? options.teamLogReply(target) : { __reply: true, status: 404, payload: {} }
        if (produced && produced.__reply === true) return jsonReply(produced.payload, produced.status)
        return jsonReply(produced)
      }
      throw new Error(`client-runtime: 意外的 fetch ${target}`)
    },
  }
  sandbox.window = {
    __ModuleLoader__: {
      load(value) {
        entry = value
      },
    },
  }
  sandbox.document = { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }) }
  // 用例可选：localStorage 桩（排序偏好「记在本机」）与 getComputedStyle 桩（§5.68 找滚动容器）。
  if (options.localStorage !== undefined) sandbox.localStorage = options.localStorage
  if (options.getComputedStyle !== undefined) sandbox.getComputedStyle = options.getComputedStyle

  const source = await readFile(CLIENT_FILE, 'utf8')
  createContext(sandbox)
  runInContext(source, sandbox, { filename: 'lib/client.js' })
  assert.ok(entry !== null, 'lib/client.js 没有调用 window.__ModuleLoader__.load')

  const plugin = entry.factory((name) => {
    if (name === 'react') return runtime.React
    // 宿主自带的 markdown 渲染器（`lib/markdown.js` 里用 try/catch 包着 require）。
    // 用例可以传一个「缺 labels 就抛」的假渲染器，来验 §5.67 的契约。
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      if (options.primitives === undefined) throw new Error(`client-runtime: 没有为 require('${name}') 提供假实现`)
      return options.primitives
    }
    throw new Error(`client-runtime: 意料之外的 require('${name}')`)
  })

  const captured = []
  const ctx = {
    effect(fn) {
      return fn()
    },
    slots: {
      inject(_name, fn) {
        return fn()
      },
      register(meta, component) {
        captured.push({ meta, component })
        return () => {}
      },
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    inject() {
      return {}
    },
    on() {},
    off() {},
    use() {},
  }
  plugin.apply(ctx)

  const roles = captured.find((item) => item.meta && item.meta.id === 'team-roles')
  assert.ok(roles, `没有捕获到 conversation.view 的 team-roles 注册，实际注册了 ${captured.map((item) => item.meta && item.meta.id).join(',') || '(无)'}`)

  runtime.mount(roles.component)
  await runtime.settle()

  const panel = {
    net,
    runtime,
    get tree() {
      return runtime.tree
    },
    settle: () => runtime.settle(),
    dispose: () => runtime.dispose(),
    text: () => textOf(runtime.tree),
    // 详情字段： div > span(标签文本) + input（client.js:2382-2441，input 无 label 属性）
    field(label) {
      let hit = null
      walk(runtime.tree, (node) => {
        if (hit !== null || node.type !== 'div') return
        const kids = node.children
        if (kids.length < 2) return
        if (!kids[0] || kids[0].type !== 'span') return
        if (kids[0].children[0] !== label) return
        if (!kids[1] || kids[1].type !== 'input') return
        hit = kids[1]
      })
      return hit
    },
    input(label) {
      const node = panel.field(label)
      assert.ok(node, `没有找到「${label}」输入框`)
      return node
    },
    button(label) {
      let hit = null
      walk(runtime.tree, (node) => {
        if (hit !== null || node.type !== 'button') return
        if (node.children.includes(label)) hit = node
      })
      return hit
    },
    async click(label) {
      const node = panel.button(label)
      assert.ok(node, `没有找到「${label}」按钮`)
      assert.notEqual(node.props.disabled, true, `「${label}」按钮是禁用的`)
      node.props.onClick()
      await runtime.settle()
    },
    checkboxes() {
      const out = []
      walk(runtime.tree, (node) => {
        if (node.type === 'input' && node.props.type === 'checkbox') out.push(node)
      })
      return out
    },
  }

  // 找一个「点了真会发出 set-switches / set-skills」的复选框（走 flushSwitches 那条
  // 路，也就是 catch 里 await refresh() 的那条路）。面板里复选框很多，别的复选框走
  // run()，拿它们测 B2 / E2 会假绿。
  async function findSwitchIndex() {
    const saved = net.commandReply
    net.commandReply = (body) => ({ state: statePayload(), action: body.action })
    try {
      const boxes = panel.checkboxes()
      for (let index = 0; index < boxes.length; index += 1) {
        const box = boxes[index]
        if (box.props.disabled === true) continue
        const before = net.commands.length
        box.props.onChange({ target: { checked: box.props.checked !== true } })
        await sleep(BURST_WAIT_MS)
        await runtime.settle()
        const sent = net.commands.slice(before)
        if (sent.some((item) => item && (item.action === 'set-switches' || item.action === 'set-skills'))) {
          return index
        }
      }
      return null
    } finally {
      net.commandReply = saved
    }
  }

  // p0 的用法：先探到下标，再在「会失败」的回包下点同一个下标。
  // 返回 `{ index }`（p0 的用例拿这个字段重定位复选框），p1 直接用 findSwitchIndex 的纯下标。
  async function clickSwitchCheckbox() {
    const index = await findSwitchIndex()
    assert.ok(index !== null, '面板里没有找到会发出 set-switches / set-skills 的复选框，用例前提不成立')
    const box = panel.checkboxes()[index]
    assert.ok(box, `第 ${index} 个复选框在重渲染后不见了`)
    const before = net.commands.length
    box.props.onChange({ target: { checked: box.props.checked !== true } })
    await sleep(BURST_WAIT_MS)
    await runtime.settle()
    assert.ok(net.commands.length > before, '第二次点击没有发出任何 /command')
    return { index }
  }

  // p1 的用法：按下标点一次，返回这次发出的 /command 条数。
  panel.clickSwitch = async (index) => {
    const box = panel.checkboxes()[index]
    assert.ok(box, `第 ${index} 个复选框不见了`)
    const before = net.commandCalls
    box.props.onChange({ target: { checked: box.props.checked !== true } })
    await sleep(BURST_WAIT_MS)
    await runtime.settle()
    return net.commandCalls - before
  }

  // 点「刷新」= run({action:'reload'})（client.js:2197），回包里带一份新的 state，
  // adopt 之后 selected 变成新对象 —— 这正是 B1 的触发点。
  async function reloadWith(nextState) {
    net.state = nextState
    net.commandReply = (body) => ({ state: nextState, action: body.action })
    await panel.click('刷新')
  }

  panel.findSwitchIndex = findSwitchIndex
  panel.probeSwitchCheckbox = findSwitchIndex
  panel.clickSwitchCheckbox = clickSwitchCheckbox
  panel.reloadWith = reloadWith

  // 注册表：`apply()` 装角色配置页（conversation.view / team-roles）与群聊视图
  // （conversation.view / team-chat）。群聊那条是 apply 里 `fetchState()` 成功后
  // 由 `chatTab.setHidden(false)` → `chatTab.mount()` 触发的，所以它一定也在 captured 里。
  panel.registration = (id) => captured.find((item) => item.meta && item.meta.id === id)
  panel.registrations = () => captured.map((item) => item.meta && item.meta.id)

  const chatProps = {
    sessionId: 'lead-1',
    subscribe: () => () => {},
    getWindow: () => ({ entries: [], hasMore: false }),
    ...(options.chat === undefined ? {} : options.chat),
  }

  // 用真群聊视图替换角色页签：props 就是宿主 inject 出来的那份 event source 形状。
  panel.mountChat = async (props = {}) => {
    const registration = panel.registration('team-chat')
    assert.ok(
      registration,
      `没有捕获到 conversation.view 的 team-chat 注册（实际注册：${panel.registrations().join(', ') || '(无)'}）`,
    )
    runtime.unmount()
    runtime.mount((incoming) => registration.component(incoming), { ...chatProps, ...props })
    await runtime.settle()
    return panel
  }

  return panel
}
