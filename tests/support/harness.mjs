/** 共享的假 Cordis 上下文：createHarness / settle / fakeRequest / call / withPlugin 的唯一来源；
 * 领域夹具在 tests/support/plugin-fixtures.mjs。 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createContext, runInContext } from 'node:vm'

import { apply } from '../../lib/index.js'
import { TEAM_BUNDLE } from '../../lib/deployment.js'
import { DEFAULT_NOTES, NOTE_KEYS } from '../../lib/notes.js'
import { NOTICE_MAX_PER_SESSION, NOTICE_SOURCE, idleMembers } from '../../lib/team-watch.js'
import { memberNameForRole, roleForMemberName } from '../../lib/roles.js'
import { SHIPPED_MODE_IDS, shippedPreset } from './shipped-presets.mjs'
import { ROSTER_ROLE_LINE, rosterText } from '../../lib/team-roster.js'

const STATE_URL = '/api/dsh-agent-team-roles/state'
const COMMAND_URL = '/api/dsh-agent-team-roles/command'
const TEAM_LOG_URL = '/api/dsh-agent-team-roles/team-log'

/** 写路径把重建排到回包之后（REBUILD_DELAY_MS = 200 的去抖计时器），所以「写完要看到新定义」的断言都得等这次后台重建落定。 */
const REBUILD_WAIT_MS = 400
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 把一份 shipped preset 包成 Loader 条目，给 harness 默认的 Loader 用。 */
const shippedEntry = (id) => ({
  id: `preset-${id}`,
  options: { name: '@deepseek-ai/dsh-agent-preset', config: shippedPreset(id) },
})

/** options.omitServices = 本 profile 不提供的服务（如无 webServer 的 headless）；pluginManager 是 bundle manager，被测团队开关的用例伪造；loader 是 Cordis Loader，读 live preset 声明。 */
function createHarness(options = {}) {
  /** @type {{ level: string, message: string }[]} */
  const log = []
  const logger = {
    info: (message) => log.push({ level: 'info', message }),
    warn: (message) => log.push({ level: 'warn', message }),
    error: (message) => log.push({ level: 'error', message }),
  }
  /** @type {{ id: string, definition: object, disposed: boolean }[]} */
  const registered = []
  /** @type {{ agent: object, preset: string }[]} */
  const selected = []
/** 假 registry 从 list() 上报的内容：failure 让调用抛，用来伪造名册读失败；listCalls / registerCalls 计两个昂贵操作，好断言一次配置写两件都没做。 */
  const registryState = { records: [], failure: null, listCalls: 0, registerCalls: 0 }
/** 真注册表拒绝绑定的方式：select() 在会话已启动后以 agent-preset/locked 拒绝。 */
  const selectFailure = { message: null }
/** 注册表上报的会话当前组合；null = 还没组合任何东西，每次创建都从这开始。 */
  const composedState = { preset: null }
  const agentPresets = {
    composedPreset: () => composedState.preset,
    async list() {
      registryState.listCalls += 1
      if (registryState.failure !== null) throw new Error(registryState.failure)
      return registryState.records
    },
    async register(definition) {
      registryState.registerCalls += 1
      if (registered.some((record) => record.id === definition.id && !record.disposed)) {
        throw new Error(`Duplicate agent preset: ${definition.id}`)
      }
      const record = { id: definition.id, definition, disposed: false }
      registered.push(record)
      return async () => {
        record.disposed = true
      }
    },
    async select(agent, preset) {
      if (selectFailure.message !== null) throw new Error(selectFailure.message)
      selected.push({ agent, preset })
      return preset
    },
  }

  /** @type {Map<string, object>} */
  const routes = new Map()
  const webServer = {
// 真服务上 get port() 是本进程监听的端口；名册互斥判定靠它拼 /dsh-arbiter/state（测试用 fetch 桩拦这个地址）。
    port: options.webServerPort ?? 3080,
    register(route) {
// 真服务对重复的 (kind, path) 抛错，harness 也一样——静默覆盖路由会藏真 bug。
      const key = `${route.kind} ${route.path}`
      if (routes.has(key)) throw new Error(`Duplicate (kind, path) route: ${key}`)
      routes.set(key, route)
      return () => routes.delete(key)
    },
  }

  /** @type {{ label: string, dispose: unknown }[]} */
  const effects = []
/** 名册块注入的两个 Agent Teams 面：只有开口要的测试才拿到；没有运行时的 profile 必须让这个 ctx.inject 一直挂着，跟真 Cordis 一样。 */
  const liveAgents = []
  const teamState = { rows: [], roles: new Map(), failure: null, tasks: [], sent: [] }
  const agentTeams = {
    tryMembership: (agent) => teamState.roles.get(agent),
    listMembers: () => {
      if (teamState.failure !== null) throw new Error(teamState.failure)
      return teamState.rows
    },
    listTasks: async () => {
      if (teamState.failure !== null) throw new Error(teamState.failure)
      return teamState.tasks
    },
/** 派发面：sendMessage(caller, request) 用活的 Agent 当调用者凭据，所以这里记下到底把谁交了出去。 */
    sendMessage: async (caller, request) => {
      if (teamState.failure !== null) throw new Error(teamState.failure)
      const receipt = { id: `team-message-${teamState.sent.length + 1}` }
      teamState.sent.push({
        caller,
        target: request?.target,
        content: request?.content,
        signal: request?.signal,
        receipt,
      })
      return receipt
    },
  }
/** 创建窗口：create/resume 是唯一接受 setup 的入口，所以假对象要可调用，并按 dsh 的做法先建 child 再 await setup。它的存在也很重要——两个方法都没有的运行时会逼插件走 announce 兜底。 */
  const creation = []
  const enterCreation = (method) => async (params) => {
    creation.push({ method, params })
    if (typeof params?.setup === 'function') await params.setup(params.childCtx, params.child)
    return params?.child
  }
  const agents = {
    list: () => [...liveAgents],
    get: (id) => liveAgents.find((agent) => agent.sessionId === id),
    create: enterCreation('create'),
    resume: enterCreation('resume'),
  }
  /** The unwrapped methods, so a test can prove the disposer put them back. */
  const agentsOriginal = { create: agents.create, resume: agents.resume }
  /** @type {Map<string, ((payload: unknown) => unknown)[]>} */
  const listeners = new Map()
/** 依赖不可用的 inject 回调：真 Cordis 会让它们一直等，所以 harness 里也永不运行。 */
  const pending = []
  const omitted = new Set(options.omitServices ?? [])
  const services = {}
  if (!omitted.has('agentPresets')) services.agentPresets = agentPresets
  if (!omitted.has('webServer')) services.webServer = webServer
  if (options.pluginManager !== undefined) services.pluginManager = options.pluginManager
  if (options.agentTeams === true) {
    services.agentTeams = agentTeams
    services.agents = agents
  }
// 只有 agents：创建窗口照样装上，但没有 Agent Teams 就没有成员名册，label 是唯一剩下的键。
  if (options.agents === true) services.agents = agents
// 根工具注册表，只有测插件可见性面板的用例伪造；没有它 readToolGate() 报告服务缺失，跟没加载 tools 行的 profile 一样。
  if (options.tools !== undefined) services.tools = options.tools
// 名册互斥靠 dsh-arbiter 的 arbiterWorkspace 服务（dir() 同步给工作区目录）。默认给 dsh-arbiter 的默认工作区；arbiterWorkspaceDir: null 模拟服务缺席，那时只靠 <homedir>\Desktop\dsh-arbiter 兜底。
  if (!omitted.has('arbiterWorkspace')) {
    const workspaceDir =
      options.arbiterWorkspaceDir === undefined ? path.join(os.homedir(), 'Desktop', 'dsh-arbiter') : options.arbiterWorkspaceDir
    services.arbiterWorkspace = { dir: () => workspaceDir }
  }
// 额外塞进来的只读服务（如别的插件 provide 的 arbiterRoles）：验证「这条会话归谁管」这类跨插件判定。
  if (options.services !== undefined) Object.assign(services, options.services)

  /** Deliver one event the way Cordis does: every listener, awaited, in order. */
  async function emit(type, payload) {
    for (const handler of listeners.get(type) ?? []) await handler(payload)
  }

  function makeCtx() {
    const ctx = {
// Loader 不是服务，挂在 context 上。部署永远持有 dsh 自带的四份 preset，所以没被塞 Loader 的 harness 就拿到这四份——插件不再留副本；传 loader: null 得到空部署。
      loader: options.loader === undefined ? { entries: () => SHIPPED_MODE_IDS.map((id) => shippedEntry(id)) } : options.loader,
      logger: () => logger,
      effect(disposeOrSetup, label) {
        const dispose = typeof disposeOrSetup === 'function' ? disposeOrSetup() : undefined
        effects.push({ label, dispose })
        return dispose
      },
      inject(dependencies, callback) {
// Cordis 只在所有必需服务就位后才跑回调、服务变了就卸载；harness 不提供的依赖意味着「永不调用」，不是「用 undefined 调用」——headless profile 考的就是这个区别。
        if (dependencies.some((dependency) => services[dependency] === undefined)) {
          pending.push({ dependencies, callback })
          return undefined
        }
        const child = Object.create(ctx)
        for (const dependency of dependencies) child[dependency] = services[dependency]
        return callback(child)
      },
// Cordis 不注入的服务查找。读 agentTeams 走这条路，所以没有运行时的 profile 里角色那半照样加载。
      get(name) {
        return services[name]
      },
      on(type, handler) {
        const bucket = listeners.get(type) ?? []
        bucket.push(handler)
        listeners.set(type, bucket)
        return () => {
          const index = bucket.indexOf(handler)
          if (index >= 0) bucket.splice(index, 1)
        }
      },
    }
    return ctx
  }

  return { ctx: makeCtx(), routes, registered, effects, log, agentPresets, selected, emit, registryState, selectFailure, pending, agentTeams, agents, agentsOriginal, creation, composedState, liveAgents, teamState }
}

/** 让插件启动时的 fire-and-forget promise 跑完：它最后一行会记「角色已就绪」或「初始化失败」。等固定轮数不可靠——收养迁移角色会在首次注册前做真文件 I/O。 */
async function settle(log) {
  const finished = () =>
    Array.isArray(log) && log.some((entry) => /角色已就绪|初始化失败/.test(String(entry.message)))
  for (let turn = 0; turn < 1000; turn += 1) {
    if (finished()) {
      // One more turn, so anything queued behind the log line can drain.
      await new Promise((resolve) => setTimeout(resolve, 0))
      return
    }
    await new Promise((resolve) => setTimeout(resolve, turn < 20 ? 0 : 2))
  }
  throw new Error(`the plugin never finished starting up: ${JSON.stringify((log ?? []).map((e) => e.message))}`)
}

function fakeRequest(method, body, url) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  return {
    method,
// team-log 路由从 query string 读 sessionId，所以测试要能给它递 URL（别的路由不读）。
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

async function call(routes, url, method = 'GET', body, requestUrl, options) {
  const route = routes.get(`exact ${url}`)
  assert.ok(route, `route not registered: ${url}`)
  /** @type {any} */
  const response = {
    status: 0,
    headers: null,
    payload: '',
    writeHead(status, headers) {
      response.status = status
      response.headers = headers
    },
    end(payload) {
      response.payload = payload ?? ''
    },
  }
  await route.handler(fakeRequest(method, body, requestUrl), response)
  const json = response.payload ? JSON.parse(response.payload) : null

// 写路径把「挂起改过的角色」放到回包之后的后台定时器里；大多数断言关心重建之后的注册表，所以默认等它落定，要断言「回包那一刻」的传 { nowait: true }。
  const pending =
    (json?.result?.deferred?.length ?? 0) > 0 || (json?.state?.deferred?.length ?? 0) > 0
  if (options?.nowait !== true && method === 'POST' && pending) {
    await new Promise((resolve) => setTimeout(resolve, 400))
  }

  return { status: response.status, json }
}

async function withPlugin(run, initialRoles, config, harnessOptions) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-roles-plugin-'))
  if (initialRoles !== undefined) {
    await writeFile(path.join(dir, 'roles.json'), JSON.stringify(initialRoles), 'utf8')
  }
  const harness = createHarness(harnessOptions)
  try {
    apply(harness.ctx, { dir, ...(config ?? {}) })
    await settle(harness.log)
    await run(harness, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export { createHarness, settle, fakeRequest, call, withPlugin }
