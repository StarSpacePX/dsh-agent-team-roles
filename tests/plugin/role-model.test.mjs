/** 角色的模型：写盘、投影，以及成员创建时把 selection 装到 agent 上。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, withPlugin } from '../support/harness.mjs'
import { definitionOf, STATE_URL, COMMAND_URL } from '../support/plugin-fixtures.mjs'
import { applyMemberModel, hasModel } from '../../lib/host/member-model.js'

/** 最小宿主状态：只放 member-model 需要的那几个服务。 */
function fakeHost({ supports = true } = {}) {
  const installed = []
  const warned = []
  const host = {
    logger: { info: () => {}, warn: (line) => warned.push(String(line)), error: () => {} },
    ctx: {
      llm: {
        async resolveCallConfig(config) {
          return {
            ...config,
            ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }),
          }
        },
      },
      get(name) {
        if (name !== 'sessionController') return undefined
        if (!supports) return {}
        return { agents: { selectForNextRequest: (agent, selection) => installed.push({ agent, selection }) } }
      },
    },
  }
  return { host, installed, warned }
}

test('a role without a model leaves the member alone', async () => {
  const { host, installed } = fakeHost()
  assert.equal(hasModel({ model: { provider: '', model: '' } }), false)
  assert.equal(await applyMemberModel(host, { session: { id: 's1' } }, { id: 'team-a', model: {} }), false)
  assert.equal(installed.length, 0)
})

test('a configured role installs one selection with the three fields', async () => {
  const { host, installed } = fakeHost()
  const applied = await applyMemberModel(host, { session: { id: 's1' } }, {
    id: 'team-a',
    model: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' },
  })
  assert.equal(applied, true)
  assert.deepEqual(installed[0].selection, {
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    reasoningEffort: 'high',
  })
})

test('an empty effort is not sent as a field', async () => {
  const { host, installed } = fakeHost()
  await applyMemberModel(host, { session: { id: 's2' } }, {
    id: 'team-b',
    model: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: '' },
  })
  assert.equal('reasoningEffort' in installed[0].selection, false)
})

test('a deployment without sessionController.agents warns instead of throwing', async () => {
  const { host, installed, warned } = fakeHost({ supports: false })
  const applied = await applyMemberModel(host, { session: { id: 's3' } }, {
    id: 'team-c',
    model: { provider: 'deepseek-official', model: 'deepseek-flash' },
  })
  assert.equal(applied, false)
  assert.equal(installed.length, 0)
  assert.equal(warned.length, 1)
})

test('set-model writes the three fields and the preset stays free of model rows', async () => {
  await withPlugin(async ({ registered, routes }) => {
    await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })
    await call(routes, COMMAND_URL, 'POST', {
      action: 'set-model',
      id: 'team-reviewer',
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      reasoningEffort: 'high',
    })

    const state = await call(routes, STATE_URL)
    const role = state.json.roles.find((entry) => entry.id === 'team-reviewer')
    assert.deepEqual(role.model, {
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      reasoningEffort: 'high',
    })

    const rows = definitionOf(registered, 'team-reviewer').plugins
    assert.equal(rows.some((entry) => entry.id === 'agent-default-model'), false)
  })
})

test('set-model with three empty strings clears the fields', async () => {
  await withPlugin(async ({ registered, routes }) => {
    await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })
    await call(routes, COMMAND_URL, 'POST', {
      action: 'set-model',
      id: 'team-reviewer',
      provider: 'deepseek-official',
      model: 'deepseek-flash',
    })
    await call(routes, COMMAND_URL, 'POST', {
      action: 'set-model',
      id: 'team-reviewer',
      provider: '',
      model: '',
      reasoningEffort: '',
    })

    const state = await call(routes, STATE_URL)
    const role = state.json.roles.find((entry) => entry.id === 'team-reviewer')
    assert.deepEqual(role.model, { provider: '', model: '', reasoningEffort: '' })
    assert.equal(
      definitionOf(registered, 'team-reviewer').plugins.some((entry) => entry.id === 'agent-default-model'),
      false,
    )
  })
})

test('set-model refuses a half-specified route', async () => {
  await withPlugin(async ({ routes }) => {
    await call(routes, COMMAND_URL, 'POST', { action: 'create-role', name: 'Reviewer' })
    const refused = await call(routes, COMMAND_URL, 'POST', {
      action: 'set-model',
      id: 'team-reviewer',
      provider: 'deepseek-official',
      model: '',
    })
    assert.notEqual(refused.status, 200)
    assert.match(String(refused.json?.error ?? ''), /provider 和 model/)
  })
})
