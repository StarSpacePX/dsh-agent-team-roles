/**
 * dsh-agent-team-roles — host half / HTTP 路由（§5.45、§5.50、§5.58 A4/D2）。
 *
 * 三条精确路由，全在一个前缀下面：
 *
 * - `GET /state`：面板正文。带 ETag，重复 GET 直接 304（§5.58 D2）；
 * - `GET /team-log?sessionId=…`：群聊历史的宿主半投影（§5.50）。409 表示「这个会话
 *   现在不在线」，是客户端会自行回退的**普通答复**，不是服务坏了；
 * - `POST /command`：唯一的写入口。`team-send` 单独在这里处理（§5.45），其余交给
 *   `mutate`，并且整条命令在 `serialize` 里排队 —— 两次 UI 点击不能交错进同一次
 *   read-modify-write（§5.58 A4：失败也要 `touchState()`，因为写可能已经落盘）。
 *
 * @module dsh-agent-team-roles/host/routes
 */
import { commandStatus, notReady, readJson, send, sendBody } from './http.js'

/** Every route this plugin serves lives under one prefix. */
const ROUTE_PREFIX = '/api/dsh-agent-team-roles'

/**
 * @param {object} h - the shared host state ({@link ./context.js}).
 * @param {object} state - the state projection API ({@link ./state.js}).
 * @param {object} commands - `{ mutate }` ({@link ./commands.js}).
 */
export function installRoutes(h, state, commands) {
  h.ctx.inject(['webServer'], (scoped) => {
    const server = scoped.webServer

    scoped.effect(
      () => {
        const disposers = [
          server.register({
            kind: 'exact',
            path: `${ROUTE_PREFIX}/state`,
            handler: async (request, response) => {
              try {
                await h.queue
                const { etag, body } = await state.buildStateCached()
                const asked = String((request.headers && request.headers['if-none-match']) ?? '').trim()
                if (asked !== '' && asked === etag) {
                  // §5.58 D2 — 304 没有 body，也就不该带 content-length。
                  response.writeHead(304, { etag, 'cache-control': 'no-cache' })
                  response.end()
                  return
                }
                sendBody(response, 200, body, { etag, 'cache-control': 'no-cache' })
              } catch (error) {
                send(response, 500, { error: String((error && error.message) || error) })
              }
            },
          }),
          server.register({
            kind: 'exact',
            path: `${ROUTE_PREFIX}/team-log`,
            handler: (request, response) => {
              if (request.method !== 'GET') {
                send(response, 405, { error: '请用 GET' })
                return
              }
              const read = h.teamLogReader
              if (read === null) {
                send(response, 503, { error: '这个部署没有 Agent Teams 运行时，读不到群聊日志' })
                return
              }
              try {
                const url = new URL(typeof request.url === 'string' ? request.url : '/', 'http://127.0.0.1')
                const sessionId = String(url.searchParams.get('sessionId') ?? '').trim()
                if (sessionId === '') throw new Error('缺少 sessionId')
                send(response, 200, { sessionId, ...read({ sessionId }) })
              } catch (error) {
                // 409, not 500: "this Session is not live right now" is an
                // ordinary answer the client falls back from (its own window),
                // not a broken server.
                send(response, 409, { error: String((error && error.message) || error) })
              }
            },
          }),
          server.register({
            kind: 'exact',
            path: `${ROUTE_PREFIX}/command`,
            handler: async (request, response) => {
              if (request.method !== 'POST') {
                send(response, 405, { error: '请用 POST' })
                return
              }
              /** The action this request named, for the failure log (§5.58 A4). */
              let action = null
              try {
                const body = await readJson(request)
                if (body !== null && typeof body === 'object') {
                  action = String(body.action ?? '').trim() || null
                }
                // §5.45 — R5's dispatch: the client claimed the draft, so this
                // one action never touches the role store and never rebuilds
                // presets; it only borrows the Lead as the caller credential.
                if (body !== null && typeof body === 'object' && body.action === 'team-send') {
                  // Deliberately **not** named `send`: that is the HTTP response
                  // helper of this file, and shadowing it here made the success
                  // reply hand the *response object* to the runtime instead —
                  // `…/tests/plugin/runtime-context.test.mjs` §5.45 caught it.
                  const dispatch = h.teamSend
                  if (dispatch === null) throw new Error('这个部署里没有 Agent Teams 运行时，没法把消息交给成员')
                  const sessionId = String(body.sessionId ?? '').trim()
                  const target = String(body.target ?? '').trim()
                  const text = String(body.body ?? '').trim()
                  if (sessionId === '') throw new Error('缺少 sessionId')
                  if (target === '') throw new Error('缺少成员名')
                  if (text === '') throw new Error('要发给成员的内容是空的')
                  const receipt = await dispatch({ sessionId, target, body: text })
                  send(response, 200, { action: 'team-send', target, receipt })
                  return
                }
                const result = await h.serialize(async () => {
                  const service = h.presets
                  if (service === null) throw notReady('agentPresets 服务尚未就绪')
                  return commands.mutate(service, body)
                })
                // §5.58 D2 — the write is the only thing that can make `/state`
                // stale within one millisecond, so it invalidates the cache here.
                state.touchState()
                send(response, 200, result)
              } catch (error) {
                const status = commandStatus(error)
                const message = String((error && error.message) || error)
                // §5.58 A4 — `/command` answered 400 for *everything*, so a
                // mistyped body and a server that broke mid-command looked
                // identical, and the panel told the user to fix their input in
                // both cases. The status now comes from the error when it knows
                // one (`exportNotes` refuses a corrupt file with 409), a
                // not-ready deployment says 503, and the rest stays 400. This
                // log line is the only record.
                const where = action === null ? 'command' : `command ${action}`
                if (status >= 500) h.logger.error(`agent-team-roles/${where} 失败：${message}`)
                else h.logger.warn(`agent-team-roles/${where} 被拒：${message}`)
                // §5.58 D2 — a refused command may still have written before it
                // failed（A4 的 `mutate` 先落盘、再在渲染回包时抛），所以失败路径
                // 也要作废缓存，否则下一条 GET /state 会把旧的正文当成新的。
                state.touchState()
                send(response, status, { error: message })
              }
            },
          }),
        ]

        return () => {
          for (const dispose of disposers) {
            try {
              dispose()
            } catch {
              // Routes are torn down with the server either way.
            }
          }
        }
      },
      'agent-team-roles: routes',
    )
  })
}
