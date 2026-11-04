/**
 * HTTP 工具：读 JSON 请求体、写 JSON 响应、把失败翻译成状态码，
 * 以及「写已经落盘但状态读取失败」时的降级答复。全是纯函数，不碰插件状态。
 *
 * @module dsh-agent-team-roles/host/http
 */

/** 请求体是小 JSON 文档，超过上限就是错的。 */
export const BODY_LIMIT = 1_000_000

/** @param {import('node:http').IncomingMessage} request @returns {Promise<object>} */
export async function readJson(request) {
  const chunks = []
  let size = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > BODY_LIMIT) {
// 超限回 413：否则 commandStatus 回落 400，会被读成「你的 JSON 错了」，让人去改本来没错的输入。
      const error = /** @type {Error & { status: number }} */ (new Error('请求体过大'))
      error.status = 413
      throw error
    }
    chunks.push(buffer)
  }

  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return {}
  return JSON.parse(text)
}

/** @param {import('node:http').ServerResponse} response @param {number} status
 * @param {unknown} payload */
export function send(response, status, payload) {
  const body = JSON.stringify(payload === undefined ? null : payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/** 发送已序列化的正文（/state 缓存存的就是它）：额外头（ETag）叠在上面，
 * cache-control 由调用方负责，所以 304 与 200 可以故意不一致。
 * @param {import('node:http').ServerResponse} response @param {number} status @param {string} body
 * @param {Record<string, string>} [headers] */
export function sendBody(response, status, body, headers = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  })
  response.end(body)
}

/** /command 失败时的状态码。
 * 以前任何错误都回 400，输入打错与「写已落盘、状态重建挂了」看起来一样，客户端会让人去改输入。
 * 错误自带状态码就沿用（exportNotes 拒绝坏文件给 409），部署未就绪给 503，其余 400。
 * @param {unknown} error @returns {number} */
export function commandStatus(error) {
  const explicit = Number((error && error.status) || NaN)
  if (Number.isInteger(explicit) && explicit >= 400 && explicit <= 599) return explicit
  if (error && error.code === 'NOT_READY') return 503
  return 400
}

/** 归咎于部署而不是请求的错误。
 * @param {string} message @returns {Error} code 为 NOT_READY */
export function notReady(message) {
  const error = /** @type {Error & { code: string }} */ (new Error(message))
  error.code = 'NOT_READY'
  return error
}

/** 写已落盘时，为重渲染失败的命令回包补一份面板状态。
 * 每次 /command 先改存储再渲染回包；渲染失败曾让整条命令报失败，重试又得到「角色已存在」。
 * 写是真的发生了，面板坏了只是另一件可以报出来的事。
 * @param {object} state @param {unknown} error @returns {Promise<object>} */
export async function stateAfterWrite(build, options = {}) {
  const fallback = options.fallback ?? null
  const warn = options.warn ?? null
  try {
    return await build()
  } catch (error) {
    const message = `命令已生效，但状态读取失败：${String((error && error.message) || error)}`
    if (typeof warn === 'function') warn(message)
    if (fallback !== null && typeof fallback === 'object') return { ...fallback, error: message }
    return { error: message }
  }
}
