/** 领域夹具：角色定义、假 teammate、假 loader、名册与任务事件……假环境本身在 ../harness.mjs。 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { TEAM_BUNDLE } from '../../lib/deployment.js'
import { createHarness, call } from './harness.mjs'
import os from 'node:os'
import path from 'node:path'

import { interpolateLikeDsh } from './plugin-fixtures-harness.mjs'

/** 一个假活 agent：scope 记下每次 systemPrompt.context() 注册，另给 §5.44 需要的两面——
 * scope 级 on()（Team 事件发给 appending Session 自己的 context 收集来的观察者）与 followup()。 */

export function fakeAgent() {
  const contexts = []
  const listeners = new Map()
  const notices = []
  const agent = {
// 名册互斥只看 cwd：假 agent 默认是普通目录会话；要监察员工作区的会话时改 agent.session.header.cwd。
    session: { id: 'session-fake', header: { cwd: path.join(os.homedir(), 'Desktop', 'dsh'), agentPreset: 'user' } },
    ctx: {
      on(type, handler) {
        const list = listeners.get(type) ?? []
        list.push(handler)
        listeners.set(type, list)
        return () => {
          const current = listeners.get(type) ?? []
          listeners.set(
            type,
            current.filter((entry) => entry !== handler),
          )
        }
      },
      systemPrompt: {
        context(entry) {
          const record = { ...entry, disposed: false }
          contexts.push(record)
          return () => {
            record.disposed = true
          }
        },
      },
    },
    followup(input) {
      notices.push(input)
    },
  }
  return {
    agent,
    contexts,
    notices,
    /** Deliver one event the way the Session does, then let observers finish. */
    async fire(type, ...args) {
      for (const handler of listeners.get(type) ?? []) await handler(...args)
    },
    /** How many live `session/event` listeners this scope still holds. */
    listenerCount(type) {
      return (listeners.get(type) ?? []).length
    },
    /** Assemble one registered context exactly as the deployment would. */
    render(index = 0) {
      const entry = contexts[index]
      assert.ok(entry !== undefined, '没有注册任何 context')
      const text = typeof entry.text === 'function' ? entry.text() : entry.text
      return interpolateLikeDsh(text)
    },
  }
}

/** Put one agent on the fake roster with the given role, and set the roster rows. */

export function rosterUp(harness, role, rows) {
  const fake = fakeAgent()
  harness.liveAgents.push(fake.agent)
  harness.teamState.roles.set(fake.agent, { role, name: role === 'lead' ? 'lead' : '架构师' })
  if (rows !== undefined) harness.teamState.rows = rows
  return fake
}

export function taskRow(id, patch = {}) {
  return {
    id,
    revision: 1,
    subject: `任务 ${id}`,
    description: '',
    status: 'pending',
    blockedBy: [],
    writeScopes: [],
    ready: true,
    writeScopeWarnings: [],
    ...patch,
  }
}

export async function skillHome() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'team-roles-skills-'))
  const write = async (name, description) => {
    const folder = path.join(home, 'skills', name)
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`, 'utf8')
    return folder
  }
  const push = await write('push', '提交并推送')
  const pptx = await write('pptx', '做 PPT')
// 根本身是 markdown 文件：discoverRoot 接受它，面板就该列出来——而它挂的是它的父目录。
  const solo = path.join(home, 'skills', 'solo.md')
  await writeFile(solo, '---\nname: solo\ndescription: 单文件技能\n---\n', 'utf8')
// 目录里没有 SKILL.md 不算技能，文件没有 frontmatter 加载器会跳过——两个都不该出现。
  await mkdir(path.join(home, 'skills', 'empty-dir'), { recursive: true })
  await mkdir(path.join(home, 'skills', 'no-frontmatter'), { recursive: true })
  await writeFile(path.join(home, 'skills', 'no-frontmatter', 'SKILL.md'), '# 没有 frontmatter\n', 'utf8')
  return { home, push, pptx, solo }
}

export function fakeLeadSession(sessionId, events) {
  let log = events.slice()
  const calls = []
  const session = {
    id: sessionId,
    get seq() {
      return log.length
    },
    snapshotEvents(from = 0, to = log.length) {
      calls.push([from, to])
      return log.slice(from, to)
    },
    append(type, data) {
      const event = { type, seq: log.length, time: 1000 + log.length, data }
      log.push(event)
      return event
    },
  }
  return {
    sessionId,
    session,
    calls,
    get length() {
      return log.length
    },
    replace(next) {
      log = next.slice()
    },
    append: session.append,
  }
}

export const teamMemberEvent = (seq, id, name) => ({
  type: 'team/member',
  seq,
  time: 1000 + seq,
  data: { version: 2, teamId: 't-1', member: { id, name, phase: 'active' } },
})

export const teamQueuedEvent = (seq, id) => ({
  type: 'team/message/queued',
  seq,
  time: 1000 + seq,
  data: {
    version: 2,
    teamId: 't-1',
    message: {
      id,
      senderId: 'lead',
      senderName: 'lead',
      targetId: 'm-1',
      content: [{ type: 'text', text: `body ${id}` }],
    },
  },
})

export const teamDeliveredEvent = (seq, messageId) => ({
  type: 'team/message/delivered',
  seq,
  time: 1000 + seq,
  data: { version: 2, teamId: 't-1', messageId },
})
/** Ordinary Session traffic — the projection must walk straight past it. */

export const fillerEvents = (from, count) =>
  Array.from({ length: count }, (_unused, index) => ({
    type: 'turn/start',
    seq: from + index,
    time: 1000 + from + index,
    data: { turn: index },
  }))
