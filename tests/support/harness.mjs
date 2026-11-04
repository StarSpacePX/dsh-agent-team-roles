/**
 * 共享的假 Cordis 上下文（施工批次 A–G 的测试共用）。
 *
 * 批次 F4：`tests/plugin.test.mjs` 已按主题拆成 `tests/plugin/*.test.mjs`，那份文件顶部
 * 的同名副本随之收敛到这里 —— 本文件现在是 `createHarness` / `settle` / `fakeRequest` /
 * `call` / `withPlugin` 的**唯一来源**；领域夹具在 `tests/support/plugin-fixtures.mjs`。
 *
 * @module dsh-agent-team-roles/tests/harness
 */
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

/**
 * §5.54 — 写路径把重建排到回包之后（`REBUILD_DELAY_MS = 200` 的去抖计时器），
 * 所以任何「写完要看到新定义」的断言都得等这一次后台重建落定。
 */
const REBUILD_WAIT_MS = 400
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * One shipped preset as a Loader entry, for the harness's default Loader (§5.62).
 *
 * @param {string} id
 */
const shippedEntry = (id) => ({
  id: `preset-${id}`,
  options: { name: '@deepseek-ai/dsh-agent-preset', config: shippedPreset(id) },
})

/**
 * @param {{ omitServices?: string[], pluginManager?: object, loader?: object }} [options] … services this profile does
 * not provide, e.g. a headless profile without `webServer`; `pluginManager` is
 * the §5.33 bundle manager, faked by the tests that exercise the team switch;
 * `loader` is the Cordis Loader, which §5.40 reads live preset declarations off.
 */
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
  /**
   * What the fake registry reports from `list()`. Tests replace the contents;
   * `failure` makes the call throw, which is how a broken roster read is faked.
   * §5.54 — `listCalls` / `registerCalls` count the two expensive operations, so a
   * test can assert that a config write performs neither of them.
   */
  const registryState = { records: [], failure: null, listCalls: 0, registerCalls: 0 }
  /**
   * How the real registry refuses a binding: `select()` rejects with
   * `agent-preset/locked` once the session has already started.
   */
  const selectFailure = { message: null }
  /**
   * §5.53 — what the registry reports as a session's current composition. `null`
   * is "nothing composed yet", which is how every creation starts.
   */
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
    // 真实服务上 `get port()` 是本进程监听的端口；名册互斥判定靠它拼
    // `/dsh-arbiter/state`（测试用 `fetch` 桩拦这个地址，不会真的发请求）。
    port: options.webServerPort ?? 3080,
    register(route) {
      // The real server throws on a duplicate `(kind, path)` pair, so the
      // harness does too … a silently overwritten route would hide a real bug.
      const key = `${route.kind} ${route.path}`
      if (routes.has(key)) throw new Error(`Duplicate (kind, path) route: ${key}`)
      routes.set(key, route)
      return () => routes.delete(key)
    },
  }

  /** @type {{ label: string, dispose: unknown }[]} */
  const effects = []
  /**
   * §5.43 — the two Agent Teams faces the roster block injects. Only a test
   * that asks for them gets them: a profile without the runtime must leave that
   * `ctx.inject` pending, exactly the way the real Cordis does.
   */
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
    /**
     * §5.45 — the dispatch face. `sendMessage(caller, request)` takes a **live
     * Agent** as the caller credential (`…\dsh-experimental-agent-team\lib\index.js:1773`),
     * so the test records exactly who was handed over.
     */
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
  /**
   * §5.53 — the creation window. `create`/`resume` are the only entry points that
   * accept a `setup`, so the fake has to be callable and has to run the composed
   * `setup(childCtx, child)` the way dsh does: the runtime builds the child, then
   * awaits the request's own setup. Its *presence* matters too — a runtime with
   * neither method is what makes the plugin keep the announce fallback and say so.
   */
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
  /**
   * Inject callbacks whose dependencies are not available. Real Cordis leaves
   * them waiting, so they never run in this harness either.
   *
   * @type {{ dependencies: string[], callback: Function }[]}
   */
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
  // §5.53 — `agents` on its own: the creation window still installs, and with no
  // Agent Teams there is no member roster, so the label is the only key left.
  if (options.agents === true) services.agents = agents
  // §5.55 — the root tool registry, faked only by the tests that exercise the
  // plugin-visibility panel; without it `readToolGate()` reports the service as
  // missing, exactly like a profile whose `tools` row is not loaded.
  if (options.tools !== undefined) services.tools = options.tools
  // 名册互斥靠 dsh-arbiter 提供的 `arbiterWorkspace` 服务（`dir()` 同步给工作区目录）。
  // 假环境默认给 dsh-arbiter 的默认工作区；`arbiterWorkspaceDir: null` 模拟服务缺席，
  // 那时只靠 `<homedir>\Desktop\dsh-arbiter` 兜底排除。
  if (!omitted.has('arbiterWorkspace')) {
    const workspaceDir =
      options.arbiterWorkspaceDir === undefined ? path.join(os.homedir(), 'Desktop', 'dsh-arbiter') : options.arbiterWorkspaceDir
    services.arbiterWorkspace = { dir: () => workspaceDir }
  }
  // 额外塞进来的只读服务（例如别的插件 `ctx.provide` 的 `arbiterRoles`）：
  // 用来验证「这条会话归谁管」这类跨插件的判定（需求 R12，用户 m02696）。
  if (options.services !== undefined) Object.assign(services, options.services)

  /** Deliver one event the way Cordis does: every listener, awaited, in order. */
  async function emit(type, payload) {
    for (const handler of listeners.get(type) ?? []) await handler(payload)
  }

  function makeCtx() {
    const ctx = {
      // §5.40 / §5.62 — the Loader is not a service; it hangs off the context. A
      // deployment always holds the four presets dsh ships, so a harness that was
      // not handed a Loader gets those four and nothing more — the plugin keeps no
      // copy any more, and a test that forgot to declare `standard` would
      // otherwise exercise a deployment that cannot exist. Pass `loader: null` to
      // get a deployment whose preset declarations cannot be read at all.
      loader: options.loader === undefined ? { entries: () => SHIPPED_MODE_IDS.map((id) => shippedEntry(id)) } : options.loader,
      logger: () => logger,
      effect(disposeOrSetup, label) {
        const dispose = typeof disposeOrSetup === 'function' ? disposeOrSetup() : undefined
        effects.push({ label, dispose })
        return dispose
      },
      inject(dependencies, callback) {
        // Cordis runs the callback only once every required service is live,
        // and unloads it again when one changes. A dependency this harness does
        // not provide therefore means "never called", not "called with
        // `undefined`" … that distinction is what a headless profile exercises.
        if (dependencies.some((dependency) => services[dependency] === undefined)) {
          pending.push({ dependencies, callback })
          return undefined
        }
        const child = Object.create(ctx)
        for (const dependency of dependencies) child[dependency] = services[dependency]
        return callback(child)
      },
      // Cordis' non-injecting service lookup. §5.46 reads `agentTeams` through
      // it so the roles half still loads in a profile without the runtime.
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

/**
 * Let the plugin's fire-and-forget startup promise run to completion.
 *
 * The startup promise is done when it says so: it logs either 「角色已就绪」 or
 * 「初始化失败」 as its last act, after the first registration pass. Waiting a
 * fixed number of turns stopped being reliable in §5.29, because adopting a
 * migrated role now does real file I/O before the first preset is registered.
 */
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
    // §5.50 — the team-log route reads its `sessionId` off the query string, so a
    // test has to be able to hand the handler a URL (the others ignore it).
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

  // §5.54 — 写路径把「把改过的角色挂起来」这件事放到了回包之后的后台定时器里。
  // 大多数断言关心的都是重建**之后**的注册表，所以这里默认等它落定；要断言「回包
  // 那一刻」的测试传 `{ nowait: true }`。
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
