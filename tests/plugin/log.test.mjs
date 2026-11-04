/** 群聊日志（空态窗口边界 / 宿主半日志投影）。
 * 投影的纯函数单测在 tests/teamLog.test.mjs；这里放需要假 Session 的那几条。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { call, withPlugin } from '../support/harness.mjs'
import { fakeLeadSession, teamMemberEvent, teamQueuedEvent, teamDeliveredEvent, fillerEvents, TEAM_LOG_URL } from '../support/plugin-fixtures.mjs'

// ---- 群聊空态的窗口边界 ----
// 外壳只给 conversation.view 一段有界的会话日志尾巴（真机实测 1041 条，seq 27883–28923），
// 而团队记录可能在更早的位置。所以「窗口里没有团队记录」绝不能渲染成「这个会话从没有过团队」，
// 页签还得能往前翻。

test('§5.48 an empty team tab walks the log backwards instead of blaming the runtime', async () => {
  const source = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
// 视图保留数据源自己的翻页门，并且知道它有没有。
  assert.match(source, /const canPage = typeof props\.loadOlder === 'function'/)
  assert.match(source, /const changed = await load\(\)/)
  assert.match(source, /if \(changed === false\) return/)
// 初次挂载什么都没看到时自动往前翻一次（每次挂载一次）。
  assert.match(source, /if \(autoScan\.current \|\| teamSeen \|\| canPage !== true \|\| folded\.hasMore !== true\) return/)
  assert.match(source, /runScanRef\.current\(8\)/)
// 截断的情况要说清记录在哪、并给出再翻八轮；运行时提示改成**有条件的** ——
// 已经开着运行时的人不该被告知去开运行时。
  assert.match(source, /const truncated = canPage === true && folded\.hasMore === true/)
  assert.match(source, /这个窗口里没有群聊记录。/)
  assert.match(source, /已经往前翻了 \$\{scan\.rounds\} 段/)
  assert.match(source, /往前翻日志找找（再翻 8 段）/)
  assert.match(source, /如果它还没开，去「设置 → 插件」里打开/)
  assert.ok(source.indexOf('如果它还没开') > 0)
// 两个分支都可达，且视图确实接上了注入的翻页门。
  assert.match(source, /loadOlder:\s*\n?\s*typeof session\.loadOlder === 'function'/)
})

//#endregion

//#region §5.50 群聊历史：客户端读投影（源码断言）

test('§5.50 the chat tab reads the host projection, and the local window stays the fallback', async () => {
  const source = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')

// 端点，以及一个短到觉得实时、长到不花钱的轮询间隔（宿主侧增量折叠，一次轮询只读一个切片）。
  assert.match(source, /const TEAM_LOG_URL = '\/api\/dsh-agent-team-roles\/team-log'/)
  assert.match(source, /const TEAM_LOG_POLL_MS = 4000/)
  assert.match(source, /function useTeamProjection\(sessionId\)/)

// 投影是**并与**窗口，不是替换：爆发期最新事件只在本地，最早的只在远端。
  assert.match(source, /function mergeTeamLog\(folded, projection\)/)
  assert.match(source, /if \(projection === null \|\| projection === undefined\) return folded/)
  assert.match(source, /const projection = useTeamProjection\(props\.sessionId\)/)
  assert.match(source, /React\.useMemo\(\(\) => mergeTeamLog\(local, projection\), \[local, projection\]\)/)
// 消息按持久 id 合并：较新 seq 赢，任一侧看到送达都算 —— 一次过期的轮询不能把已送达翻回未送达。
  assert.match(source, /const newer = \(row\.seq \?\? 0\) >= \(existing\.seq \?\? 0\) \? row : existing/)
  assert.match(source, /delivered: row\.delivered === true \|\| existing\.delivered === true/)
// 投影从日志第一条事件折起，所以「往前翻」没有意义。
  assert.match(source, /hasMore: false,/)
  assert.match(source, /const truncated = canPage === true && folded\.hasMore === true/)
// 头部不再标注显示的是哪份日志；「不是整份日志」那条悬停说明不受影响，这里只钉头部那个 span。
  assert.ok(
    !source.includes("h('span', { style: chatStyles.note }, '整份日志')"),
    '页头第一行不再标注日志范围',
  )
// 隐藏的页签没人看投影。
  assert.match(source, /document\.hidden !== true/)
})

//#endregion

// ---- 宿主半的日志投影 ----
// 浏览器只持有会话日志的有界尾巴，宿主侧改从**第一条**事件起折 Lead 自己的日志并提供结果，
// 于是客户端不用翻页，也不需要 Postgres。下面的假对象是 dsh-session 里这个特性用到的部分。

test('§5.50 the team log route projects the whole Session log, not the client tail', async () => {
  await withPlugin(
    async (harness) => {
// 团队在很长的会话最开始干过活 —— 正是「记录在 21801、客户端窗口 27883+」的形状。
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
// 游标跟的是最后一条**团队**事件，不是日志长度：它后面 1200 条填充物不归这个投影管。
      assert.equal(response.json.lastSeq, 2)

// 浏览器本来会看到的 1200 条尾巴，被压成一条气泡：投影从第一条事件答起。
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
// 成员记录被第一次轮询折进去了，仍在；第二次轮询只问了它之后追加的部分。
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

// 会话在缓存下被换掉（新的 fork）：游标越过新末尾时不能继续静默供旧名册。
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
// headless profile 根本没有 agents / agentTeams 服务；客户端读到 503，退回自己的事件窗口。
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

// 卸载会移除活的 agent：同一个会话 id，全新的日志。
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
