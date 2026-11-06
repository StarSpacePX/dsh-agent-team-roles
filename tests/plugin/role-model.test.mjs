/** 角色的模型：预设里那一行、命令写盘与状态投影。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, withPlugin } from '../support/harness.mjs'
import { definitionOf, STATE_URL, COMMAND_URL } from '../support/plugin-fixtures.mjs'

test('set-model writes the three fields and the preset gains the model row', async () => {
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

    const row = definitionOf(registered, 'team-reviewer').plugins.find((entry) => entry.id === 'agent-default-model')
    assert.deepEqual(row.config, {
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      reasoningEffort: 'high',
    })
  })
})

test('set-model with three empty strings removes the row again', async () => {
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

    const rows = definitionOf(registered, 'team-reviewer').plugins
    assert.equal(rows.some((entry) => entry.id === 'agent-default-model'), false)
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
