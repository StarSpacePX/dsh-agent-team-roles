/** 群聊日志（空态窗口边界 / 客户端读账本）。
 * 账本纯函数的单测跟宿主一起在 relay 测试里；这里放需要假 Session 的那几条。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { call, withPlugin } from '../support/harness.mjs'
import { fakeLeadSession, teamMemberEvent, teamQueuedEvent, teamDeliveredEvent, fillerEvents, TEAM_LOG_URL } from '../support/plugin-fixtures.mjs'

/** 账本目录跟着 DSH_HOME 走（`defaultDir()` = `<DSH_HOME>/agent-team-roles`），
 * 这里把 home 临时指到 withPlugin 给的临时目录，测完还原。 */
async function withHome(dir, run) {
  const before = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    return await run()
  } finally {
    if (before === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = before
  }
}

// ---- 群聊空态的窗口边界 ----
// 外壳只给 conversation.view 一段有界的会话日志尾巴（真机实测 1041 条，seq 27883–28923），
// 而团队记录可能在更早的位置。所以「窗口里没有团队记录」绝不能渲染成「这个会话从没有过团队」，
// 页签还得能往前翻。

test('an empty team tab walks the log backwards instead of blaming the runtime', async () => {
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
// 视图接上了「同团队其它会话」的订阅口（一条转达消息只落在收件人的会话里）。
  assert.match(source, /withPeers: \(ids, selfId\) => \{/)
})

//#endregion

//#region 群聊历史：客户端读账本（源码断言）

test('the chat tab reads the host ledger and folds relayed windows', async () => {
  const source = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')

// 账本端点，打开页面读一次；实时靠各会话的 eventSource，不再轮询。
  assert.match(source, /const TEAM_LOG_URL = '\/api\/dsh-agent-team-roles\/team-log'/)
  assert.match(source, /function useTeamProjection\(sessionId\)/)
  assert.ok(!source.includes('TEAM_LOG_POLL_MS'), '不再有轮询间隔')

// 一条转达消息只落在收件人的会话里：这一页要订阅「本会话 + 同团队其它会话」的窗口，
// 把历史与实时按消息 id 合并，按 time 排序（不同会话的 seq 不可比）。
  assert.match(source, /function foldRelayMessages\(sources\)/)
  assert.match(source, /props\.withPeers\(pageIds, props\.sessionId\)/)
  assert.match(source, /const live = foldRelayMessages\(\[\{ receiverId: props\.sessionId, window \}, \.\.\.partnerWindows\]\)/)
  assert.match(source, /sort\(\(left, right\) => \(left\.time \?\? 0\) - \(right\.time \?\? 0\)\)/)

// 老 UI 一行没动：folded 指向同一份页数据，hasMore 恒 false，「往前翻」分支自然不再触发。
  assert.match(source, /const folded = page;/)
  assert.match(source, /messages, hasMore: false/)
  assert.match(source, /const truncated = canPage === true && folded\.hasMore === true/)

// 宿主侧不再折会话事件。
  assert.ok(!source.includes('mergeTeamLog'), '不再合并宿主投影')
  assert.ok(!source.includes('foldTeamEvents'), '不再折 team/message 事件')
})

//#endregion

// ---- 宿主侧的日志投影 ----
// 浏览器只持有会话日志的有界尾巴，宿主侧改从**第一条**事件起折 Lead 自己的日志并提供结果，
// 于是客户端不用翻页，也不需要 Postgres。下面的假对象是 dsh-session 里这个特性用到的部分。

test('the team log route reads the whole ledger, not the client window', async () => {
  await withPlugin(
    async (harness, dir) =>
      withHome(dir, async () => {
// 账本：一个团队一个文件，文件名就是 Lead 的会话 id，消息落在磁盘上，跟浏览器窗口无关。
      const lead = fakeLeadSession('lead-1', [teamMemberEvent(0, 'm-1', '架构师')])
      harness.liveAgents.push(lead)
// 名册决定这一页允许出现谁：没有这名成员，消息会被过滤掉。
      harness.teamState.rows.push({ id: 'm-1', name: '架构师', role: 'teammate', status: 'active' })
      const messagesDir = path.join(dir, 'agent-team-roles', 'messages')
      await mkdir(messagesDir, { recursive: true })
      const rows = [
        {
          message: { id: 'relay:lead-1:3:0', senderId: 'lead-1', targetId: 'm-1', content: [{ type: 'text', text: '你好' }] },
          seq: 3,
          time: 1000,
          delivered: true,
        },
        {
          message: { id: 'relay:m-1:5:0', senderId: 'm-1', targetId: 'lead-1', content: [{ type: 'text', text: '收到' }] },
          seq: 5,
          time: 2000,
          delivered: true,
        },
      ]
      await writeFile(
        path.join(messagesDir, 'lead-1.jsonl'),
        `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
        'utf8',
      )

      const response = await call(harness.routes, TEAM_LOG_URL, 'GET', undefined, `${TEAM_LOG_URL}?sessionId=lead-1`)
      assert.equal(response.status, 200)
      assert.equal(response.json.teamId, 'lead-1')
      assert.deepEqual(response.json.messages.map((row) => row.message.id), ['relay:lead-1:3:0', 'relay:m-1:5:0'])
// 消息按 time 排（不是 seq）：两条行来自不同会话，seq 不可比。
      assert.deepEqual(response.json.messages.map((row) => row.time), [1000, 2000])
      assert.deepEqual(response.json.messages.map((row) => row.message.senderName), ['lead', '架构师'])
// 一条会话日志都没扫：账本读自磁盘。
        assert.deepEqual(lead.calls, [])
      }),
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )
})

test('the route refuses politely: 405 for a POST', async () => {
  await withPlugin(
    async (harness) => {
      const lead = fakeLeadSession('lead-1', [teamMemberEvent(0, 'm-1', '架构师')])
      harness.liveAgents.push(lead)

      const offline = await call(harness.routes, TEAM_LOG_URL, 'GET', undefined, `${TEAM_LOG_URL}?sessionId=lead-9`)
// 账本在磁盘上，会话下线照样能读（空账本 200），不再因为运行时里没有它就 409。
      assert.equal(offline.status, 200)
      assert.deepEqual(offline.json.messages, [])

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

test('without the Agent Teams runtime the route says so instead of pretending', async () => {
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

//#endregion
