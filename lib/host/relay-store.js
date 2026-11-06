/**
 * 群聊消息的落盘。
 *
 * 一个团队（= 一个 Lead 会话）一个文件，一条消息只写一次：
 *
 *     <dsh home>/agent-team-roles/messages/<leadSessionId>.jsonl
 *
 * Lead 的群聊页读全份；成员的群聊页读**同一个文件**，按「收发方里有自己」过滤。
 * 文件里不会躺别的团队的消息，也不会同一条消息写两遍。
 *
 * 同一条消息可能因为重放被追加两次，读的时候按 `message.id` 去重。
 *
 * 写失败只 warn，读失败当空。
 *
 * @module dsh-agent-team-roles/host/relay-store
 */
import fs from 'node:fs'
import path from 'node:path'

import { defaultDir } from '../store.js'

/** @returns {string} the messages root directory. */
export function messageDir() {
  return path.join(defaultDir(), 'messages')
}

/**
 * The journal of one team, keyed by its Lead Session id.
 *
 * @param {string} leadId
 * @returns {string}
 */
export function leadJournal(leadId) {
  return path.join(messageDir(), `${String(leadId)}.jsonl`)
}

/**
 * Read one journal, tolerating a missing file and corrupted lines.
 *
 * @param {string} file
 * @returns {object[]} rows, deduplicated by `message.id`, in file order.
 */
export function readRows(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const seen = new Set()
  const rows = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      // 尾部被截断（写到一半崩了）只是丢一条消息，不该让页签整个坏掉。
      continue
    }
    if (row === null || typeof row !== 'object') continue
    const message = row.message
    if (message === null || typeof message !== 'object' || typeof message.id !== 'string') continue
    if (seen.has(message.id)) continue
    seen.add(message.id)
    rows.push(row)
  }
  return rows
}

/**
 * 找出这个会话所属团队的账本（文件名就是 Lead 的 id）。
 *
 * 归属**只看磁盘**：账本里哪份文件出现过这个会话，它就属于那个团队。
 * 不看运行时——成员跑完下线、进程重启，都不影响。
 *
 * 自己就是 Lead 时文件名等于自己，直接命中（不看内容）。
 *
 * @param {string} sessionId
 * @returns {string} the Lead Session id, or `sessionId` when nothing matches yet.
 */
export function leadIdOf(sessionId) {
  const self = String(sessionId)
  let names
  try {
    names = fs.readdirSync(messageDir())
  } catch {
    return self
  }
  for (const name of names) {
    if (name.endsWith('.jsonl') !== true) continue
    const leadId = name.slice(0, -'.jsonl'.length)
    if (leadId === self) return leadId
    for (const row of readRows(path.join(messageDir(), name))) {
      const message = row.message
      if (String(message.senderId) === self || String(message.targetId) === self) return leadId
    }
  }
  return self
}

/**
 * Append rows to one journal. Never throws.
 *
 * @param {string} file
 * @param {{ message: object }[]} rows
 * @param {(message: string) => void} [warn]
 */
export function appendRows(file, rows, warn) {
  if (Array.isArray(rows) !== true || rows.length === 0) return
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')
  } catch (error) {
    if (typeof warn === 'function') warn(`群聊消息落盘失败：${String((error && error.message) || error)}`)
  }
}
