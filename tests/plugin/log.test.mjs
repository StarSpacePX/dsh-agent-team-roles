/**
 * 群聊日志（§5.48 空态窗口边界 / §5.50 宿主半日志投影）
 *
 * 来源：`tests/plugin/ui-and-log.test.mjs` 的日志那一半。投影的纯函数单测在
 * `tests/teamLog.test.mjs`；这里放需要假 Session 的那几条。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { call, withPlugin } from '../support/harness.mjs'
import { fakeLeadSession, teamMemberEvent, teamQueuedEvent, teamDeliveredEvent, fillerEvents, TEAM_LOG_URL } from '../support/plugin-fixtures.mjs'

//#region §5.48 群聊空态的窗口边界（用户 m13214：「明明我已经启动了team，为啥群聊里面还显示要我启动？」）
// The shell hands `conversation.view` a bounded tail of the session log — measured
// on the live session: 1041 entries, seq 27883–28923, while its eight `team/*`
// records sat at seq 21801–21862. So "the window holds no team records" must never
// be rendered as "this session never had a team", and the tab has to walk back.

test('§5.48 an empty team tab walks the log backwards instead of blaming the runtime', async () => {
  const source = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
  // The view keeps the source's own paging door, and knows whether it has one.
  assert.match(source, /const canPage = typeof props\.loadOlder === 'function'/)
  assert.match(source, /const changed = await load\(\)/)
  assert.match(source, /if \(changed === false\) return/)
  // A fresh mount that sees nothing pages back on its own, once per mount.
  assert.match(source, /if \(autoScan\.current \|\| teamSeen \|\| canPage !== true \|\| folded\.hasMore !== true\) return/)
  assert.match(source, /runScanRef\.current\(8\)/)
  // The truncated case says where the records are, and offers the next eight rounds;
  // the runtime hint is now **conditional** — it may not tell a user who has the
  // runtime switched on to go and switch it on.
  assert.match(source, /const truncated = canPage === true && folded\.hasMore === true/)
  assert.match(source, /这个窗口里没有群聊记录。/)
  assert.match(source, /已经往前翻了 \$\{scan\.rounds\} 段/)
  assert.match(source, /往前翻日志找找（再翻 8 段）/)
  assert.match(source, /如果它还没开，去「设置 → 插件」里打开/)
  assert.ok(source.indexOf('如果它还没开') > 0)
  // Both branches are reachable and the view is wired with the door in the inject.
  assert.match(source, /loadOlder:\s*\n?\s*typeof session\.loadOlder === 'function'/)
})

//#endregion

//#region §5.50 群聊历史：客户端读投影（源码断言）

test('§5.50 the chat tab reads the host projection, and the local window stays the fallback', async () => {
  const source = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')

  // The endpoint, and a poll interval short enough to feel live and long enough
  // to be free (the host folds incrementally, so a poll is one slice).
  assert.match(source, /const TEAM_LOG_URL = '\/api\/dsh-agent-team-roles\/team-log'/)
  assert.match(source, /const TEAM_LOG_POLL_MS = 4000/)
  assert.match(source, /function useTeamProjection\(sessionId\)/)

  // The projection is merged **with** the window, not instead of it: during a
  // burst the newest events only exist locally, and the oldest only remotely.
  assert.match(source, /function mergeTeamLog\(folded, projection\)/)
  assert.match(source, /if \(projection === null \|\| projection === undefined\) return folded/)
  assert.match(source, /const projection = useTeamProjection\(props\.sessionId\)/)
  assert.match(source, /React\.useMemo\(\(\) => mergeTeamLog\(local, projection\), \[local, projection\]\)/)
  // Messages merge by durable id: newer seq wins, and delivery seen by either
  // side counts — a stale poll must not flip a delivered message back.
  assert.match(source, /const newer = \(row\.seq \?\? 0\) >= \(existing\.seq \?\? 0\) \? row : existing/)
  assert.match(source, /delivered: row\.delivered === true \|\| existing\.delivered === true/)
  // The projection folds from the log's first event, so paging back is moot.
  assert.match(source, /hasMore: false,/)
  assert.match(source, /const truncated = canPage === true && folded\.hasMore === true/)
  // …and the header no longer labels which log it is showing（用户 2026-10-13 要去掉「整份日志」）。
  // 注意：那条「不是整份日志」的悬停说明文字不受影响，所以这里只钉头部那一个 span。
  assert.ok(
    !source.includes("h('span', { style: chatStyles.note }, '整份日志')"),
    '页头第一行不再标注日志范围',
  )
  // A hidden tab has nobody to show a projection to.
  assert.match(source, /document\.hidden !== true/)
})

//#endregion

//#region §5.50 群聊历史：宿主半的日志投影（用户 m13923 第 3 条）
// The browser only holds a bounded tail of the Session log (§5.48). The host
// folds the Lead's own log
// instead — from its **first** event — and serves the result, so the client does
// not need paging, and nobody needs Postgres to use the tab.
//
// The fake below is the part of `dsh-session`'s `Session` this feature touches:
// `seq` (how long the log is) and `snapshotEvents(from, to)` (a slice of it).

test('§5.50 the team log route projects the whole Session log, not the client tail', async () => {
  await withPlugin(
    async (harness) => {
      // The team worked at the very beginning of a long Session, exactly the
      // shape §5.48 measured (record at seq 21801, client window 27883+).
      const lead = fakeLeadSession('lead-1', [
        teamMemberEvent(0, 'm-1', '架构师'),
        teamQueuedEvent(1, 'msg-1'),
        teamDeliveredEvent(2, 'msg-1'),
        ...fillerEvents(3, 1200),
      ])
      harness.liveAgents.push(lead)

      const response = await call(
        harness.routes,
        TEAM_LOG_URL,
        'GET',
        undefined,
        `${TEAM_LOG_URL}?sessionId=lead-1`,
      )
      assert.equal(response.status, 200)
      assert.equal(response.json.sessionId, 'lead-1')
      assert.equal(response.json.teamId, 't-1')
      assert.deepEqual(response.json.members.map((member) => member.id), ['m-1'])
      assert.deepEqual(response.json.messages.map((row) => row.message.id), ['msg-1'])
      assert.deepEqual(response.json.messages.map((row) => row.delivered), [true])
      assert.equal(response.json.applied, 3)
      // The cursor tracks the last **team** event, not the log length: the 1200
      // fillers after it are not this projection's business.
      assert.equal(response.json.lastSeq, 2)

      // 1200 tail-only entries the browser would have seen reduced to one bubble:
      // the projection answered from the log's first event.
      assert.equal(lead.calls[0][0], 0)
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )
})

test('§5.50 the projection is folded incrementally, one slice per poll', async () => {
  await withPlugin(
    async (harness) => {
      const lead = fakeLeadSession('lead-1', [teamMemberEvent(0, 'm-1', '架构师'), ...fillerEvents(1, 10)])
      harness.liveAgents.push(lead)

      const first = await call(harness.routes, TEAM_LOG_URL, 'GET', undefined, `${TEAM_LOG_URL}?sessionId=lead-1`)
      assert.equal(first.status, 200)
      assert.deepEqual(first.json.messages, [])

      lead.append('team/message/queued', teamQueuedEvent(11, 'msg-1').data)
      const second = await call(harness.routes, TEAM_LOG_URL, 'GET', undefined, `${TEAM_LOG_URL}?sessionId=lead-1`)
      assert.equal(second.status, 200)
      assert.deepEqual(second.json.messages.map((row) => row.message.id), ['msg-1'])
      // The member record was folded by the first poll and is still there: the
      // second poll asked only for what was appended after it.
      assert.deepEqual(second.json.members.map((member) => member.id), ['m-1'])
      assert.deepEqual(lead.calls, [
        [0, 11],
        [11, 12],
      ])
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )
})

test('§5.50 a log that got shorter (fork / folded replay) restarts the fold', async () => {
  await withPlugin(
    async (harness) => {
      const lead = fakeLeadSession('lead-1', [teamMemberEvent(0, 'm-1', '架构师'), ...fillerEvents(1, 20)])
      harness.liveAgents.push(lead)
      const first = await call(harness.routes, TEAM_LOG_URL, 'GET', undefined, `${TEAM_LOG_URL}?sessionId=lead-1`)
      assert.deepEqual(first.json.members.map((member) => member.id), ['m-1'])

      // The Session was replaced under the cache (a fresh fork): a cursor past
      // the new end must not silently keep serving the old roster.
      lead.replace([teamMemberEvent(0, 'm-9', 'reviewer')])
      const second = await call(harness.routes, TEAM_LOG_URL, 'GET', undefined, `${TEAM_LOG_URL}?sessionId=lead-1`)
      assert.equal(second.status, 200)
      assert.deepEqual(second.json.members.map((member) => member.id), ['m-9'])
      assert.equal(second.json.applied, 1)
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )
})

test('§5.50 the route refuses politely: 409 for a dead Session, 405 for a POST', async () => {
  await withPlugin(
    async (harness) => {
      const lead = fakeLeadSession('lead-1', [teamMemberEvent(0, 'm-1', '架构师')])
      harness.liveAgents.push(lead)

      const offline = await call(harness.routes, TEAM_LOG_URL, 'GET', undefined, `${TEAM_LOG_URL}?sessionId=lead-9`)
      assert.equal(offline.status, 409)
      assert.match(offline.json.error, /这个会话不在线/)

      const missing = await call(harness.routes, TEAM_LOG_URL, 'GET', undefined, TEAM_LOG_URL)
      assert.equal(missing.status, 409)
      assert.match(missing.json.error, /缺少 sessionId/)

      const posted = await call(
        harness.routes,
        TEAM_LOG_URL,
        'POST',
        { sessionId: 'lead-1' },
        `${TEAM_LOG_URL}?sessionId=lead-1`,
      )
      assert.equal(posted.status, 405)
      assert.match(posted.json.error, /请用 GET/)
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )
})

test('§5.50 without the Agent Teams runtime the route says so instead of pretending', async () => {
  // A headless profile has no `agents` / `agentTeams` service at all; the client
  // reads the 503 and falls back to its own event window.
  await withPlugin(
    async (harness) => {
      const response = await call(
        harness.routes,
        TEAM_LOG_URL,
        'GET',
        undefined,
        `${TEAM_LOG_URL}?sessionId=lead-1`,
      )
      assert.equal(response.status, 503)
      assert.match(response.json.error, /Agent Teams 运行时/)
    },
    { version: 1, roles: [] },
  )
})

test('§5.50 a disposed Session drops its cached projection', async () => {
  await withPlugin(
    async (harness) => {
      const lead = fakeLeadSession('lead-1', [teamMemberEvent(0, 'm-1', '架构师')])
      harness.liveAgents.push(lead)
      assert.equal(
        (await call(harness.routes, TEAM_LOG_URL, 'GET', undefined, `${TEAM_LOG_URL}?sessionId=lead-1`)).status,
        200,
      )

      // Disposal removes the live agent: same Session id, brand-new log.
      harness.liveAgents.length = 0
      await harness.emit('agent/disposed', { agent: lead })
      assert.equal(
        (await call(harness.routes, TEAM_LOG_URL, 'GET', undefined, `${TEAM_LOG_URL}?sessionId=lead-1`)).status,
        409,
      )

      const reborn = fakeLeadSession('lead-1', [teamMemberEvent(0, 'm-9', 'reviewer')])
      harness.liveAgents.push(reborn)
      const response = await call(harness.routes, TEAM_LOG_URL, 'GET', undefined, `${TEAM_LOG_URL}?sessionId=lead-1`)
      assert.equal(response.status, 200)
      assert.deepEqual(response.json.members.map((member) => member.id), ['m-9'])
      assert.equal(response.json.applied, 1, '重建后的投影从零开始，不会带上上一个会话的成员')
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )
})

//#endregion
