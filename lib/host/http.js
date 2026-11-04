/**
 * dsh-agent-team-roles — host half / HTTP 工具（§7 F2、§5.58 A4/D2）。
 *
 * 这四条路由共用的读写原语：读 JSON 请求体、写 JSON 响应、把失败翻译成状态码，
 * 以及「写已经落盘但状态读取失败」时的降级答复。它们全是纯函数（不碰插件状态），
 * 所以单独成文件，读路径与写路径都从这里取。
 *
 * @module dsh-agent-team-roles/host/http
 */

/** Request bodies are small JSON documents; anything larger is a mistake. */
export const BODY_LIMIT = 1_000_000

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<object>}
 */
export async function readJson(request) {
  /** @type {Buffer[]} */
  const chunks = []
  let size = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > BODY_LIMIT) {
      // §7 F2 — HTTP 413 is the status for "your body is too large". Without it
      // `commandStatus` falls back to 400, which reads as "your JSON is wrong"
      // and sends the user off to fix input that was never the problem.
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

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 */
export function send(response, status, payload) {
  const body = JSON.stringify(payload === undefined ? null : payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/**
 * §5.58 D2 — `send` for a body that is already serialized, which is what the
 * `/state` cache keeps. Extra headers (the ETag) ride on top; the caller owns
 * `cache-control`, so a 304 and a 200 can disagree about it on purpose.
 *
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {string} body
 * @param {Record<string, string>} [headers]
 */
export function sendBody(response, status, body, headers = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  })
  response.end(body)
}

/**
 * The status for a failed `/command`.
 *
 * `/command` used to answer 400 for *everything*: a typo in the body looked
 * exactly like a broken state rebuild after the write had already landed, and
 * the client — quite correctly — told the user to go fix their input. An error
 * that carries its own status keeps it (`exportNotes` reports 409 for a
 * `notes.json` it refuses to overwrite), and an error that is the deployment's
 * fault rather than the request's says so with `NOT_READY`. Everything else
 * stays 400, which is what every refusal has always answered.
 *
 * @param {unknown} error
 * @returns {number} a 4xx/5xx status.
 */
export function commandStatus(error) {
  const explicit = Number((error && error.status) || NaN)
  if (Number.isInteger(explicit) && explicit >= 400 && explicit <= 599) return explicit
  if (error && error.code === 'NOT_READY') return 503
  return 400
}

/**
 * An error that blames the deployment, not the request.
 *
 * @param {string} message
 * @returns {Error} with `code` set to `NOT_READY`.
 */
export function notReady(message) {
  const error = /** @type {Error & { code: string }} */ (new Error(message))
  error.code = 'NOT_READY'
  return error
}

/**
 * Rebuild the panel state for a command reply whose write has already landed.
 *
 * Every `/command` mutates the store first and renders its reply second. When
 * the render failed, the whole command was reported as failed — and retrying it
 * answered 「角色已存在」 for a role the first attempt had in fact created
 * (§5.58 A4). The write happened; a broken panel is a separate, reportable
 * thing, so this never throws: it reports the failure inside the state it
 * returns, over the last state that did render, and hands the message to the
 * caller's logger.
 *
 * @param {() => Promise<object>} build
 * @param {{ fallback?: object | null, warn?: ((message: string) => void) | null }} [options]
 * @returns {Promise<object>}
 */
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
