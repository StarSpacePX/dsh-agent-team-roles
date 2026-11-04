/**
 * §5.58 D1 — the creation window is a monkey patch on `agents`, a process-wide
 * service that ACP / headless / SDK all share. These tests pin the two things
 * that make it survivable:
 *
 *   1. the wrapper only speaks the single-object signature it was built for —
 *      any other call shape goes through untouched;
 *   2. unloading never leaves our shell alive on the chain and never tears down
 *      a wrapper a later plugin installed on top of ours.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../lib/index.js'
import { INSTRUCTION_ROW_ID } from '../lib/deployment.js'
import { withInstructionHome } from '../lib/roles.js'
import { rosterText } from '../lib/team-roster.js'
import { call, createHarness, withPlugin } from './support/harness.mjs'

const WINDOW_LABEL = 'agent-team-roles: creation window'
const STATE_URL = '/api/dsh-agent-team-roles/state'
const COMMAND_URL = '/api/dsh-agent-team-roles/command'

/** Install the plugin with the creation window armed, on a throwaway data dir. */
async function withWindow(run) {
  const base = await mkdtemp(path.join(tmpdir(), 'team-p1-'))
  try {
    const harness = createHarness({ agents: true })
    apply(harness.ctx, { dir: path.join(base, 'roles'), bindMembers: true })
    const effect = harness.effects.find((entry) => entry.label === WINDOW_LABEL)
    assert.ok(effect, '创建窗口没有装上')
    await run(harness, effect.dispose)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

test('D1: 创建窗口装上包装，卸载后两个方法都原样还原', async () => {
  await withWindow(async (harness, dispose) => {
    assert.notEqual(harness.agents.create, harness.agentsOriginal.create, 'create 应该被包装')
    assert.notEqual(harness.agents.resume, harness.agentsOriginal.resume, 'resume 应该被包装')

    dispose()

    assert.equal(harness.agents.create, harness.agentsOriginal.create)
    assert.equal(harness.agents.resume, harness.agentsOriginal.resume)
  })
})

test('D1: 委派创建被包上我们的 setup，没有 parentAgent 的创建原样透传', async () => {
  await withWindow(async (harness) => {
    const setup = async () => {}

    await harness.agents.create({ sessionId: 'child-1', parentAgent: { sessionId: 'lead-1' }, setup })
    const delegated = harness.creation.at(-1).params
    assert.notEqual(delegated.setup, setup, '委派创建应该带上我们的 setup')
    assert.equal(delegated.sessionId, 'child-1')

    await harness.agents.create({ sessionId: 'solo', setup })
    assert.equal(harness.creation.at(-1).params.setup, setup, '没有创建窗口可用的字段时不该动它')
  })
})

test('D1: 别的插件在我们之后插队时，卸载只断开自己、不拆别人的链', async () => {
  await withWindow(async (harness, dispose) => {
    const ours = harness.agents.create
    const theirs = function outsider(params, ...rest) {
      return ours.call(this, params, ...rest)
    }
    harness.agents.create = theirs

    dispose()

    assert.equal(harness.agents.create, theirs, '不该把后装的包装一起丢掉')

    const setup = async () => {}
    await harness.agents.create({ sessionId: 'child-2', parentAgent: { sessionId: 'lead-1' }, setup })
    assert.equal(
      harness.creation.at(-1).params.setup,
      setup,
      '卸载后我们的壳必须退化成纯透传，不能再包 setup',
    )
  })
})

test('D1: 卸载是幂等的，重复调用也不会碰别人的包装', async () => {
  await withWindow(async (harness, dispose) => {
    const ours = harness.agents.create
    const theirs = function outsider(params, ...rest) {
      return ours.call(this, params, ...rest)
    }
    harness.agents.create = theirs

    dispose()
    dispose()

    assert.equal(harness.agents.create, theirs)
  })
})

test('D1: 非单对象形状的调用原样透传，绝不静默改写', async () => {
  await withWindow(async (harness) => {
    await harness.agents.create(undefined)
    assert.equal(harness.creation.at(-1).params, undefined)

    await harness.agents.create('nope')
    assert.equal(harness.creation.at(-1).params, 'nope')

    // 数组哪怕被挂上了 sessionId / parentAgent，也不是上游 `create(options)` 的形状：
    // 我们不能把它展开成一个新对象再递下去。
    const arrayish = []
    arrayish.sessionId = 'child-3'
    arrayish.parentAgent = { sessionId: 'lead-1' }
    await harness.agents.create(arrayish)
    assert.equal(harness.creation.at(-1).params, arrayish, '数组必须逐字透传')
  })
})

/**
 * `withPlugin`'s `call()` cannot set request headers, and §5.58 D2 is entirely
 * about a request header — so this drives the registered route directly.
 */
async function hitState(harness, headers = {}) {
  const route = harness.routes.get(`exact ${STATE_URL}`)
  assert.ok(route, '/state 路由没注册')
  const request = {
    method: 'GET',
    url: STATE_URL,
    headers,
    async *[Symbol.asyncIterator]() {},
  }
  /** @type {any} */
  const response = {
    status: 0,
    headers: null,
    payload: '',
    writeHead(status, head) {
      response.status = status
      response.headers = head
    },
    end(payload) {
      response.payload = payload ?? ''
    },
  }
  await route.handler(request, response)
  return { status: response.status, headers: response.headers, body: response.payload }
}

test('D2: GET /state 带 ETag，两次调用正文逐字相同', async () => {
  await withPlugin(async (harness) => {
    const first = await hitState(harness)
    assert.equal(first.status, 200)
    assert.match(String(first.headers.etag ?? ''), /^W\/"[0-9a-f]{40}"$/)
    assert.equal(first.headers['cache-control'], 'no-cache')
    assert.ok(JSON.parse(first.body).dir, '正文仍然是一份完整状态')

    const second = await hitState(harness)
    assert.equal(second.status, 200)
    assert.equal(second.headers.etag, first.headers.etag)
    assert.equal(second.body, first.body)
  })
})

test('D2: If-None-Match 命中回 304 且不带正文，不匹配仍回 200', async () => {
  await withPlugin(async (harness) => {
    const first = await hitState(harness)

    const cached = await hitState(harness, { 'if-none-match': first.headers.etag })
    assert.equal(cached.status, 304)
    assert.equal(cached.body, '', '304 不能带正文')
    assert.equal(cached.headers.etag, first.headers.etag)

    const stale = await hitState(harness, { 'if-none-match': 'W/"0000000000000000000000000000000000000000"' })
    assert.equal(stale.status, 200)
    assert.equal(stale.body, first.body)
  })
})

test('D2: 走一次 /command 之后缓存作废，ETag 跟着变', async () => {
  await withPlugin(async (harness) => {
    const first = await hitState(harness)
    const before = JSON.parse(first.body).hideChatTab

    const posted = await call(harness.routes, COMMAND_URL, 'POST', {
      action: 'set-hide-chat-tab',
      enabled: !before,
    })
    assert.equal(posted.status, 200)

    const after = await hitState(harness)
    assert.equal(after.status, 200)
    assert.equal(JSON.parse(after.body).hideChatTab, !before)
    assert.notEqual(after.headers.etag, first.headers.etag, '写过的命令必须让 ETag 变')
  })
})

test('D2: 有人直接改 notes.json，缓存也要作废', async () => {
  await withPlugin(async (harness, dir) => {
    const first = await hitState(harness)
    const notes = JSON.parse(first.body).notes
    const key = Object.keys(notes.values)[0]
    assert.ok(key, '状态里应该至少有一条说明书')

    await writeFile(path.join(dir, 'notes.json'), JSON.stringify({ [key]: 'D2-外部改的' }), 'utf8')

    const after = await hitState(harness)
    assert.notEqual(after.headers.etag, first.headers.etag, '磁盘改过的文件必须让 ETag 变')
    assert.equal(JSON.parse(after.body).notes.values[key], 'D2-外部改的')
  })
})

/** A child session carrying exactly one `subagent/descriptor` label. */
function childWithLabel(label) {
  return { session: { ownEvents: () => [{ type: 'subagent/descriptor', data: { label } }] } }
}

/**
 * §5.58 D3 — the creation window must *select* a role, and `composeFrom` cannot
 * do that: it only joins the *parent's* standing mount and takes no preset id
 * (`Source\DSH\packages\preset\agent-presets\src\index.ts:484-493`). These pin
 * the semantics we rely on instead of the one we cannot use.
 */
test('D3: 子上下文已经 compose 到同一角色时，不再重复 select', async () => {
  await withWindow(async (harness) => {
    const created = await call(harness.routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })
    assert.equal(created.status, 200)
    const role = JSON.parse((await hitState(harness)).body).roles.at(-1)
    assert.ok(role && typeof role.id === 'string', `角色应该有 id：${JSON.stringify(role)}`)

    harness.composedState.preset = role.id
    await harness.agents.create({
      sessionId: 'child-same',
      parentAgent: { sessionId: 'lead-1' },
      childCtx: {},
      child: childWithLabel('Reviewer'),
    })

    assert.deepEqual(harness.selected, [], '已经在对的角色上，不该再 select 一次')
  })
})

test('D3: select 被拒（agent-preset/locked）时，创建照常完成并留下一条 warn', async () => {
  await withWindow(async (harness) => {
    const created = await call(harness.routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })
    assert.equal(created.status, 200)

    harness.selectFailure.message =
      'agent-preset/locked: session "child-locked" has already started; its agent preset is fixed'

    const child = childWithLabel('Reviewer')
    const done = await harness.agents.create({
      sessionId: 'child-locked',
      parentAgent: { sessionId: 'lead-1' },
      childCtx: {},
      child,
    })

    assert.equal(done, child, '我们的绑定失败绝不能把创建一起拖垮')
    assert.deepEqual(harness.selected, [])
    assert.ok(
      harness.log.some((entry) => entry.level === 'warn' && entry.message.includes('成员角色绑定失败')),
      '至少要留一条 warn，不许静默失败',
    )
  })
})

test('D3: 我们绝不改写 meta.agentPreset（那是记录字段，不是选择钩子）', async () => {
  await withWindow(async (harness) => {
    const meta = { agentPreset: 'lead-preset', keep: true }
    await harness.agents.create({
      sessionId: 'child-meta',
      parentAgent: { sessionId: 'lead-1' },
      childCtx: {},
      child: childWithLabel('Nobody'),
      meta,
    })

    const passed = harness.creation.at(-1).params
    assert.equal(passed.meta, meta, 'meta 必须原样透传，不能换成新对象')
    assert.equal(passed.meta.agentPreset, 'lead-preset', '我们没有任何资格改写它')
    assert.equal(passed.meta.keep, true)
    assert.deepEqual(harness.selected, [], '没有匹配的角色就不该 select')
  })
})

/**
 * §5.58 D4 — 「两份 AGENTS.md」只在 override 失效时出现。角色目录就住在 `~/.dsh`
 * 里面，所以「同目录候选」和「user-global 候选」会指向同一位置；上游跨目录不去重
 * （`…\dsh-agent-instructions\lib\index.js:632`），一旦让位就是同一份内容注入两遍。
 * 这里锁住让位的条件：只有**指向别处**的 dshHome 才让位。
 */
test('D4: dshHome 只在指向别处时让位，null / 空串仍然走角色目录 override', () => {
  const roleHome = path.join('C:', 'data', 'team-a')

  // 用户明确指到别处 → 一个字都不改（连对象身份都不变）
  const pinned = { [INSTRUCTION_ROW_ID]: { config: { dshHome: 'D:/other-home' } } }
  assert.equal(withInstructionHome(pinned, roleHome), pinned)

  // null / 空串是 applyConfig 的「删掉这个键」，不是「别再写这个键」：
  // 放它赢就等于把同一份 AGENTS.md 交给上游注入两遍。
  for (const value of [null, undefined, '', '   ']) {
    const overrides = { [INSTRUCTION_ROW_ID]: { config: { dshHome: value } } }
    const next = withInstructionHome(overrides, roleHome)
    assert.equal(
      next[INSTRUCTION_ROW_ID].config.dshHome,
      roleHome,
      `dshHome=${JSON.stringify(value)} 不该挡住 override`,
    )
  }

  // 行不存在也要能造出来，且行的其它 config 键一个不丢
  const kept = withInstructionHome({ [INSTRUCTION_ROW_ID]: { config: { maxBytes: 4096 } } }, roleHome)
  assert.equal(kept[INSTRUCTION_ROW_ID].config.maxBytes, 4096)
  assert.equal(kept[INSTRUCTION_ROW_ID].config.dshHome, roleHome)

  // home 为空 = 「按原样别动」，这是调用方的意思，不是我们的
  assert.equal(withInstructionHome(pinned, ''), pinned)
  assert.equal(withInstructionHome(pinned, '   '), pinned)
})
