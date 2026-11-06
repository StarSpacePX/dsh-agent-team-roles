/** 运行时上下文（名册 / 任务唤醒 / @ 派发）。
 * 从 tests/plugin.test.mjs 拆分而来（超 400 行红线），测试体只做了 import 路径加深一层。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'
import { apply } from '../../lib/index.js'
import { LEAD_DISPATCH_LINES, TEAMMATE_REPLY_LINES, TEAMMATE_STYLE_LINE } from '../../lib/team-roster.js'
import { NOTICE_MAX_PER_SESSION, NOTICE_SOURCE, idleMembers } from '../../lib/team-watch.js'
import { call, withPlugin } from '../support/harness.mjs'
import { fakeAgent, rosterUp, taskRow, COMMAND_URL } from '../support/plugin-fixtures.mjs'

// ---- @ 派发： 「@成员 正文」直接发给成员 ----
// 这个构建里 matchEnter 对 @ 草稿永远不会被调用（onEnter 只把 / 开头的草稿送进 adjudicate），
// 所以认领 token 走**空格**。

test('the claimed draft reaches the member and rebuilds nothing', async () => {
  await withPlugin(
    async (harness) => {
      const rows = [
        { id: 's1', name: 'lead', role: 'lead', status: 'inactive' },
        { id: 'm1', name: '架构师', role: 'teammate', status: 'inactive' },
      ]
      const lead = rosterUp(harness, 'lead', rows)
      lead.agent.sessionId = 's1'
      await harness.emit('agent/created', { agent: lead.agent })
      const before = harness.registered.length

      const response = await call(harness.routes, COMMAND_URL, 'POST', {
        action: 'team-send',
        sessionId: 's1',
        target: '架构师',
        body: '把 §5.45 写完',
      })

      assert.equal(response.status, 200)
      assert.equal(response.json.action, 'team-send')
      assert.equal(response.json.target, '架构师')
      assert.deepEqual(response.json.receipt, { id: 'team-message-1' })

      assert.equal(harness.teamState.sent.length, 1)
      const [dispatch] = harness.teamState.sent
      assert.equal(
        dispatch.caller,
        lead.agent,
        'caller 必须是 ctx.agents.get(sessionId) 拿到的那个 live Agent（运行时按引用比对）',
      )
      assert.equal(dispatch.target, '架构师')
      assert.deepEqual(dispatch.content, [{ type: 'text', text: '把 §5.45 写完' }])
      assert.ok(dispatch.signal !== undefined, 'signal 必填：投递内部会解引用它')

      // 这条 action 借的是运行时，不是 store：一条预设都不重建。
      assert.equal(harness.registered.length, before)
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )
})

test('an empty draft, an offline session and a missing runtime are all refused', async () => {
  await withPlugin(
    async (harness) => {
      const rows = [
        { id: 's1', name: 'lead', role: 'lead', status: 'inactive' },
        { id: 'm1', name: '架构师', role: 'teammate', status: 'inactive' },
      ]
      const lead = rosterUp(harness, 'lead', rows)
      lead.agent.sessionId = 's1'
      await harness.emit('agent/created', { agent: lead.agent })

      const send = (body) => call(harness.routes, COMMAND_URL, 'POST', { action: 'team-send', ...body })

      const empty = await send({ sessionId: 's1', target: '架构师', body: '   ' })
      assert.equal(empty.status, 400)
      assert.match(empty.json.error, /内容是空的/)

      const noSession = await send({ sessionId: ' ', target: '架构师', body: '在吗' })
      assert.equal(noSession.status, 400)
      assert.match(noSession.json.error, /缺少 sessionId/)

      const noTarget = await send({ sessionId: 's1', target: '', body: '在吗' })
      assert.equal(noTarget.status, 400)
      assert.match(noTarget.json.error, /缺少成员名/)

      // Lead 不在线：没有 live Agent 可以当 caller。
      const offline = await send({ sessionId: 's9', target: '架构师', body: '在吗' })
      assert.equal(offline.status, 400)
      assert.match(offline.json.error, /不在线/)

      assert.equal(harness.teamState.sent.length, 0, '一次都不该真投出去')

      // 运行时自己拒了（成员刚好被 dispose、信箱满了、团队正在拆）时，错误里必须
      // 带上成员名 —— 那部分运维没法从英文原文里还原出来。
      harness.teamState.failure = 'teammate "架构师" is not an active member'
      const refused = await send({ sessionId: 's1', target: '架构师', body: '在吗' })
      assert.equal(refused.status, 400)
      assert.match(refused.json.error, /没能把消息交给「架构师」/)
      assert.match(refused.json.error, /is not an active member/)
      assert.equal(harness.teamState.sent.length, 0)
      harness.teamState.failure = null
    },
    { version: 1, roles: [] },
    undefined,
    { agentTeams: true },
  )

  // 没有 Agent Teams 的 profile：注入留在 pending，这条 action 报错而不是崩。
  await withPlugin(
    async (harness) => {
      const response = await call(harness.routes, COMMAND_URL, 'POST', {
        action: 'team-send',
        sessionId: 's1',
        target: '架构师',
        body: '在吗',
      })
      assert.equal(response.status, 400)
      assert.match(response.json.error, /没有 Agent Teams 运行时/)
    },
    { version: 1, roles: [] },
  )
})

test('the @ source claims on the space and leaves file references alone', async () => {
  const source = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')

// 可选注入：inputTriggers 不能进插件自己的 inject 数组 —— 硬依赖会让缺 input-trigger bundle 的
// profile 里整块插件不加载（面板与群聊 tab 陪葬）。lib/client.js 是构建产物，插件对象由入口模块的
// 命名空间拼出：入口那条 const inject = [...] 经 exports.inject 挂到工厂返回值上。
  const ownInject = source.match(/const inject = \[([^\]]*)\]/)
  assert.ok(ownInject, '没找到插件的 inject 数组')
  assert.match(source, /exports\.inject = inject/)
  assert.equal(ownInject[1].includes('inputTriggers'), false)
  assert.match(source, /ctx\.inject\(\['inputTriggers'\]/)

  assert.match(source, /trigger:\s*'@'/)
  assert.match(source, /matchSpace\s*\(/)
  // 这个构建里 `@` 草稿永远不走 matchEnter，写了也是死代码。
  assert.equal(/\bmatchEnter\s*\(/.test(source), false)

  // 认领 token 必须带尾随空格：就是这一下把输入切进 claimed 态。
  assert.match(source, /token:\s*`\$\{shown\} `/)

  // 正文只走一条 team-send；名册读共享投影（不再折会话事件窗）。
  assert.match(source, /action:\s*'team-send'/)
  assert.match(source, /projectionsBySession/)
  assert.equal(/foldTeamEvents/.test(source), false)
})

test('the browser half instantiates under the page module loader', async () => {
// node --check 只证明语法过得去，证明不了作用域。上一版把 @ 源插到 function apply(ctx) 外面
// （apply 在群聊 tab 那段就收尾了），浏览器加载时报 ctx is not defined，整个插件连角色面板都起不来，
// 而源码断言测试全绿。所以这里按页面那套加载器真的求值一次：stub window.__ModuleLoader__，调 factory。
  const source = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')

  let entry
  const sandbox = {
    window: { __ModuleLoader__: { load: (value) => { entry = value } } },
    console,
  }
  createContext(sandbox)
  runInContext(source, sandbox, { filename: 'lib/client.js' })

  assert.ok(entry, 'window.__ModuleLoader__.load 没有被调用')
  assert.equal(entry.id, 'dsh-agent-team-roles')

  const React = new Proxy(
    {},
    {
      get: (_target, prop) => (prop === 'createElement' ? () => null : () => undefined),
    },
  )
  const plugin = entry.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require(${JSON.stringify(name)})`)
  })
  assert.equal(plugin.name, 'dsh-agent-team-roles')
  assert.equal(typeof plugin.apply, 'function')
  // vm 里造出来的数组原型是那个 realm 的 Array，deepEqual 会因此判不等。
  assert.equal(Array.from(plugin.inject).join(','), 'slots,sessions')
})

//#endregion

//#region 技能单独配置（用户 ：「技能也要能单独配置」）

/** A deployment of one skill directory, plus the file-shaped skill beside it. */
