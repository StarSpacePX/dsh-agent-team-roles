/**
 * 收到一条会话事件，该写哪份账本。
 *
 * 一条转达消息只落在**收件人**的会话日志里，所以「全队都在哪」要从收件人反推：
 *
 *   - 收件人是成员 → 这条同时属于 Lead 视角（`<lead>.jsonl`）和这个成员视角
 *   - 收件人是 Lead → 这条属于 Lead 视角，以及**发送者那个成员**的视角
 *
 * 团队归属 = 该会话 root：会话头 `header.parentSession` 是它的 Lead，
 * Lead 自己的会话没有 parent，root 就是它自己。
 *
 * 这里只算「写哪个文件、写什么行」，不碰盘，方便单测。
 *
 * @module dsh-agent-team-roles/host/relay-record
 */
import { relayRowsFromEvent } from '../team-messages.js'
import { leadJournal } from './relay-store.js'

/**
 * The Team this Session belongs to —— 只读会话头，一条路。
 *
 * 会话头里本来就有归属：`Session.header.parentSession`。`spawn_teammate` 建的成员会话
 * 指向它的 Lead，Lead 自己的会话没有这个字段。不能问运行时（`tryMembership`）：
 * 成员不跑的时候运行时答不上来。
 *
 * @param {any} session - a live session (`id`, `header.parentSession`).
 * @returns {string | undefined} the Lead Session id, or undefined when unknown.
 */
export function rootIdOf(session) {
  if (session === null || typeof session !== 'object') return undefined
  const header = session.header
  const parent = header !== null && typeof header === 'object' ? header.parentSession : undefined
  if (typeof parent === 'string' && parent !== '') return parent
  return typeof session.id === 'string' ? session.id : undefined
}

/**
 * One event → the journal it belongs to（一个团队一个文件，只写一次）。
 *
 * @param {any} session - the session that appended the event (the recipient).
 * @param {object} event - the raw `SessionEvent`.
 * @returns {{ file: string, rows: object[] }[]} empty when the event carries no team message.
 */
export function relayWrites(session, event) {
  const selfId = session === null || typeof session !== 'object' ? undefined : session.id
  const rootId = rootIdOf(session)
  if (typeof selfId !== 'string' || typeof rootId !== 'string') return []

  const rows = relayRowsFromEvent(event, selfId)
  if (rows.length === 0) return []
  return [{ file: leadJournal(rootId), rows }]
}
