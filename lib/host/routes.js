/**
 * HTTP 路由，全部在同一个前缀下：
 *
 * - GET /state：面板正文，带 ETag，重复 GET 直接 304；
 * - GET /team-log?sessionId=…：群聊历史的宿主侧投影，409 表示该会话此刻不在线，
 *   是客户端会自行回退的普通答复，不是服务坏了；
 * - POST /command：唯一写入口，team-send 单独处理，其余交给 mutate，
 *   整条命令在 serialize 里排队，两次点击不会交错。
 *
 * @module dsh-agent-team-roles/host/routes
 */
import { commandStatus, notReady, readJson, send, sendBody } from './http.js'

/** 本插件的所有路由共用一个前缀。 */
const ROUTE_PREFIX = '/api/dsh-agent-team-roles'

/** @param {object} h 共享宿主状态 @param {object} state 状态投影
 * @param {object} commands `{ mutate }` */
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
// 304 没有 body，也就不该带 content-length。
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
// 用 409 而不是 500：「这个会话现在不在线」是普通答复，客户端会回退到自己的窗口。
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
/** 本次请求的 action 名，供失败日志用。 */
              let action = null
              try {
                const body = await readJson(request)
                if (body !== null && typeof body === 'object') {
                  action = String(body.action ?? '').trim() || null
                }
// team-send 不碰角色存储、不重建 preset，只借用 Lead 作为调用凭据。
                if (body !== null && typeof body === 'object' && body.action === 'team-send') {
// 故意不叫 send：那是本文件的 HTTP 回包函数，遮蔽它会让成功回包把响应对象交给运行时。
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
// 写是唯一能让 /state 在一毫秒内过期的事，所以在这里作废缓存。
                state.touchState()
                send(response, 200, result)
              } catch (error) {
                const status = commandStatus(error)
                const message = String((error && error.message) || error)
// /command 以前对任何错误都回 400，输入错和服务器中途坏掉看起来一样；
// 现在按错误类型给状态码（坏文件 409、部署未就绪 503、其余 400）。
                const where = action === null ? 'command' : `command ${action}`
                if (status >= 500) h.logger.error(`agent-team-roles/${where} 失败：${message}`)
                else h.logger.warn(`agent-team-roles/${where} 被拒：${message}`)
// 被拒的命令可能已经落盘（mutate 先写、再在渲染回包时抛），失败路径同样要作废缓存。
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
// 路由随服务器一起拆掉，两种方式都一样。
            }
          }
        }
      },
      'agent-team-roles: routes',
    )
  })
}
