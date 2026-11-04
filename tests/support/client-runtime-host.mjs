/** 共享的浏览器端测试运行时（p0-client 与 p1-client 共用）：把 lib/client.js 装进 vm 求值，
 * 用极简 React 运行时真渲染、真点按钮、真拦 fetch。 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_FILE = path.resolve(HERE, '..', '..', 'lib', 'client.js')

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// set-switches 的 burst 是 120ms，留足余量。
export const BURST_WAIT_MS = 300
// 请求超时 15s 等不起：sandbox 里的 setTimeout 把 ≥10s 的延时压成 5ms（其它保持原样），
// 于是超时是真被 AbortController 触发的，只是时钟走得快。
export const LONG_TIMER_THRESHOLD_MS = 10000
export const LONG_TIMER_FAKE_MS = 5

export function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

export function abortFailure() {
  const failure = new Error('PROBE-请求超时中止')
  failure.name = 'AbortError'
  return failure
}

// ---------------------------------------------------------------------------
// 极简 React 运行时：只实现 client.js 用到的 hook，语义按 React 来
// （依赖数组不变不重跑、对象引用变了就重跑）。
// ---------------------------------------------------------------------------
export function sameDeps(previous, next) {
  if (previous === undefined || next === undefined) return false
  if (previous.length !== next.length) return false
  for (let i = 0; i < previous.length; i += 1) {
    if (!Object.is(previous[i], next[i])) return false
  }
  return true
}

export function createRuntime(options = {}) {
  // 每个组件实例（按它在树里的位置定身份）一份 hook 存储，跟 React 一样。
  const frames = new Map()
  let current = null
  let dirty = true
  let rootElement = null
  let tree = null
  let effects = []

  const schedule = () => {
    dirty = true
  }

  const use = (init) => {
    const frame = current
    while (frame.cells.length <= frame.cursor) frame.cells.push({})
    const cell = frame.cells[frame.cursor]
    frame.cursor += 1
    if (init) init(cell)
    return cell
  }

  const React = {
    Fragment: Symbol.for('react.fragment'),
    createElement(type, props, ...children) {
      return {
        type,
        props: props === null || props === undefined ? {} : props,
        children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false && child !== true),
      }
    },
    useState(initial) {
      const cell = use((self) => {
        if (!('value' in self)) self.value = typeof initial === 'function' ? initial() : initial
      })
      if (cell.setter === undefined) {
        cell.setter = (next) => {
          const value = typeof next === 'function' ? next(cell.value) : next
          if (!Object.is(value, cell.value)) {
            cell.value = value
            schedule()
          }
        }
      }
      return [cell.value, cell.setter]
    },
    useRef(initial) {
      const cell = use((self) => {
        if (!('ref' in self)) self.ref = { current: initial }
      })
      return cell.ref
    },
    useMemo(factory, deps) {
      const cell = use()
      if (!sameDeps(cell.deps, deps)) {
        cell.deps = deps === undefined ? undefined : deps.slice()
        cell.value = factory()
      }
      return cell.value
    },
    useCallback(fn, deps) {
      return React.useMemo(() => fn, deps)
    },
    useEffect(fn, deps) {
      const cell = use()
      const shouldRun = !sameDeps(cell.deps, deps)
      cell.deps = deps === undefined ? undefined : deps.slice()
      if (shouldRun) {
        cell.fn = fn
        effects.push(cell)
      }
    },
// 群聊视图用 useLayoutEffect 在首帧前把宿主滚动条拉回顶部；这里跟 useEffect 同一时机，断言只看「挂载后 scrollTop 变没变」。
    useLayoutEffect(fn, deps) {
      React.useEffect(fn, deps)
    },
  }

// 把 h() 造的树真的展开成宿主元素树：遇到函数组件就调它。path 决定实例身份，跟 React「同一位置就是同一实例」等价；
// 少了这步，h(McpPanel, {...}) 只是空壳，面板里那一大片开关根本不会渲染。
  function renderElement(node, at) {
    if (node === null || node === undefined || typeof node !== 'object') return node
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        node[index] = renderElement(node[index], `${at}.${index}`)
      }
      return node
    }
    if (typeof node.type === 'function') {
      const id = `${at}#${node.type.name || 'anonymous'}`
      let frame = frames.get(id)
      if (frame === undefined) {
        frame = { id, cells: [], cursor: 0 }
        frames.set(id, frame)
      }
      const previous = current
      current = frame
      frame.cursor = 0
      let rendered
      try {
        rendered = node.type(node.props)
      } finally {
        current = previous
      }
      return renderElement(rendered, id)
    }
    for (let index = 0; index < node.children.length; index += 1) {
      node.children[index] = renderElement(node.children[index], `${at}/${String(node.type)}.${index}`)
    }
// 宿主节点的 ref 要真指到节点：群聊视图靠 rootRef.current.parentElement 往上找滚动容器。
    if (node.props.ref !== undefined && node.props.ref !== null && typeof node.props.ref === 'object') {
      node.props.ref.current = node
    }
    if (typeof options.decorateHost === 'function') options.decorateHost(node)
    return node
  }

// 一直渲染到没有新 state 变更、也没有新 effect 要跑；每轮让出一个宏任务，好让 fetch 的 promise 链推进。
  async function settle(maxRounds = 80) {
    let idle = 0
    for (let round = 0; round < maxRounds; round += 1) {
      const needsRender = dirty || tree === null
      if (needsRender) {
        dirty = false
        effects = []
        tree = renderElement(rootElement, 'root')
        const pending = effects
        for (const cell of pending) {
          const cleanup = cell.fn()
          cell.cleanup = typeof cleanup === 'function' ? cleanup : undefined
        }
      }
      await new Promise((resolve) => setImmediate(resolve))
      if (!needsRender && !dirty) {
        idle += 1
        if (idle >= 2) return tree
      } else {
        idle = 0
      }
    }
    return tree
  }

  function dispose() {
    for (const frame of frames.values()) {
      for (const cell of frame.cells) {
        if (typeof cell.cleanup === 'function') cell.cleanup()
        cell.cleanup = undefined
      }
    }
    effects = []
  }

  return {
    React,
    settle,
    dispose,
    mount(next, props = {}) {
      rootElement = React.createElement(next, props)
      dirty = true
      tree = null
    },
// 换根组件前先收干净（跑 cleanup、丢 hook 存储）：不清的话角色页签的定时器会留在事件循环里，node --test 退不出去。
    unmount() {
      dispose()
      frames.clear()
      rootElement = null
      tree = null
      dirty = true
    },
    get tree() {
      return tree
    },
  }
}

// ---------------------------------------------------------------------------
// 遍历 / 查找工具
// ---------------------------------------------------------------------------