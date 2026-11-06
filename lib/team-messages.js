/**
 * 《群聊》的消息本体：直接消费两边的事件，记录消息本身。
 *
 * dsh 0.2.1-rc.5 起团队运行时不再往 Lead 日志里追加 `team/message/*`，消息改成
 * 投递时的一条通用事件 `agent/inbox/spliced`（见 `dsh-experimental-agent-team/lib/index.js`
 * 的 `sendAdmitted`：只 `steer` / `steerHostSubagentPrompt`，没有任何 `appendAndFlush`）。
 *
 * 这条通用事件**两边都有**，而且**一条消息只落一份**——它落在收件人自己的会话日志里，
 * `data.inserted[]` 里带 `source: { kind: 'agent-message', form: 'relay', senderSessionId }`。
 * 所以插件在 Lead 和每个成员的 `session/event` 上都装监听，收到就归一化、存自己的一份。
 *
 * 这里只有纯函数：不读盘、不发请求。
 *
 * @module dsh-agent-team-roles/team-messages
 */

/** The generic append that carries a relayed peer message. */
export const RELAY_EVENT_TYPE = 'agent/inbox/spliced'

/**
 * 运行时给转达消息加的抬头（`Team message from devtest:`）。它是协议的一部分，
 * 不是用户写的内容，进群聊前剥掉。
 */
const SPEAKER_PREFIX = /^Team message from [^:\n]+:\s*$/

/**
 * Extract the peer-message rows carried by one Session event.
 *
 * @param {object} event - a raw `SessionEvent` (`{ type, seq, time, data }`).
 * @param {string} receiverId - the Session that received the insert.
 * @returns {{ message: object, seq: number | null, time: number | null, delivered: boolean }[]}
 */
export function relayRowsFromEvent(event, receiverId) {
  if (event === null || typeof event !== 'object') return []
  if (event.type !== RELAY_EVENT_TYPE) return []
  const data = event.data
  if (data === null || typeof data !== 'object') return []
  if (Array.isArray(data.inserted) !== true) return []

  const seq = Number(event.seq)
  const time = Number(event.time)
  const rows = []
  for (const [index, entry] of data.inserted.entries()) {
    if (entry === null || typeof entry !== 'object') continue
    const source = entry.source
    if (source === null || typeof source !== 'object') continue
    // 只认同伴消息：普通用户 prompt 也走同一条 splice，但绝不能折进群聊。
    if (source.kind !== 'agent-message') continue

    const senderId = typeof source.senderSessionId === 'string' ? source.senderSessionId : ''
    const blocks = Array.isArray(entry.content) ? entry.content : []
    const texts = []
    for (const block of blocks) {
      if (block !== null && typeof block === 'object' && typeof block.text === 'string') texts.push(block.text)
    }
    while (texts.length > 0 && SPEAKER_PREFIX.test(texts[0].trim()) === true) texts.shift()
    const body = texts.join('\n')
    if (body.trim() === '') continue

    rows.push({
      message: {
        // 运行时这里不给持久消息 id，身份只能用唯一稳定的元组：发送者 + 这次接收事件。
        id: `relay:${senderId}:${String(event.seq)}:${index}`,
        senderId,
        targetId: receiverId,
        content: [{ type: 'text', text: body }],
      },
      seq: Number.isFinite(seq) ? seq : null,
      time: Number.isFinite(time) ? time : null,
      delivered: true,
    })
  }
  return rows
}

/**
 * 一页群聊的消息行：有序，发送者/收件人名字已解析。
 *
 * 成员资格由调用方决定：一页只带它点名的那些会话的行，所以成员页不会串出别人的往返。
 *
 * 排序按 `time` 不按 `seq`：行来自不同会话的日志，`seq` 是各自会话的计数器，不可比。
 *
 * @param {{ message: object, seq?: number | null, time?: number | null }[]} rows
 * @param {{ allowed: Set<string>, nameOf: (id: string) => string }} options
 * @returns {{ message: object, seq: number | null, time: number | null, delivered: boolean }[]}
 */
export function serializeMessages(rows, options) {
  const out = []
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const message = row.message
    if (message === null || typeof message !== 'object') continue
    const senderId = String(message.senderId)
    const targetId = String(message.targetId)
    if (options.allowed.has(senderId) !== true || options.allowed.has(targetId) !== true) continue
    out.push({
      message: {
        id: message.id,
        senderId,
        senderName: options.nameOf(senderId),
        targetId,
        targetName: options.nameOf(targetId),
        content: message.content,
      },
      seq: row.seq ?? null,
      time: row.time ?? null,
      delivered: row.delivered === true,
    })
  }
  out.sort((left, right) => (left.time ?? 0) - (right.time ?? 0))
  return out
}
