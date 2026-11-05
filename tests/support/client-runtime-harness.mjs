/** 共享的浏览器端测试运行时（p0-client 与 p1-client 共用）：把 lib/client.js 真的装进 vm 求值，
 * 用极简 React 运行时真渲染面板、真改输入框、真点按钮、真拦 fetch。 */

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
    // stateReply / commandReply 给用例改：返回 payload，或抛错。
    stateReply: options.stateReply || null,
    commandReply: options.commandReply || null,
  }

  const sandbox = {
    console,
// 请求超时是 15s，测试把 ≥10s 的延时压成 5ms（burst 120ms、ERROR_TTL_MS 8000 原样），
// 这样「超时中止」真的由 AbortController 触发。E2 那种「故意挂住、晚点再回」的用例要关掉压缩。
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
// signal 被 abort 时真实 fetch 以 AbortError 拒绝——这里照做。
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
        const scope = 'panel'
        const call = net.stateCalls
        return Promise.race([
          (async () => {
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
// 用例可选：localStorage 桩（排序偏好在本机）与 getComputedStyle 桩（找滚动容器）。
  if (options.localStorage !== undefined) sandbox.localStorage = options.localStorage
  if (options.getComputedStyle !== undefined) sandbox.getComputedStyle = options.getComputedStyle

  const source = await readFile(CLIENT_FILE, 'utf8')
  createContext(sandbox)
  runInContext(source, sandbox, { filename: 'lib/client.js' })
  assert.ok(entry !== null, 'lib/client.js 没有调用 window.__ModuleLoader__.load')

  const plugin = entry.factory((name) => {
    if (name === 'react') return runtime.React
// 宿主自带的 markdown 渲染器；用例可以传一个「缺 labels 就抛」的假渲染器验契约。
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
// 详情字段：div > span(标签文本) + input（input 无 label 属性）。
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

// 找一个「点了真会发出 set-switches / set-skills」的复选框（走 flushSwitches 那条路）。
// 面板里复选框很多，别的走 run()，拿它们测 B2 / E2 会假绿。
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

// p0 的用法：先探到下标，再在「会失败」的回包下点同一个下标；返回 { index } 供重定位。
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

// 点「刷新」= run({action:'reload'})，回包带一份新 state，adopt 之后 selected 变成新对象——这正是 B1 的触发点。
  async function reloadWith(nextState) {
    net.state = nextState
    net.commandReply = (body) => ({ state: nextState, action: body.action })
    await panel.click('刷新')
  }

  panel.findSwitchIndex = findSwitchIndex
  panel.probeSwitchCheckbox = findSwitchIndex
  panel.clickSwitchCheckbox = clickSwitchCheckbox
  panel.reloadWith = reloadWith

// 注册表：apply() 只装角色配置页。
  panel.registration = (id) => captured.find((item) => item.meta && item.meta.id === id)
  panel.registrations = () => captured.map((item) => item.meta && item.meta.id)

  return panel
}
