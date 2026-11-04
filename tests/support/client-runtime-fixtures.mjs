// 共享的浏览器端测试运行时 —— p0-client.test.mjs 与 p1-client.test.mjs 共用。
//
// 为什么是行为测试而不是源码正则断言：B1 的病根在 effect 的依赖数组（对象引用
// 每次回包都变），B2 在异步时序，E1/E2/E3 在超时、并发与缺字段兜底。正则断言只
// 能证明「代码里写着某句话」，证明不了「用户看到的东西变了」。所以这里把
// lib/client.js 真的装进 vm 求值，用一个极简 React 运行时真渲染面板、真改输入框、
// 真点按钮、真拦截 fetch。
//
// 这一份是从两个测试文件里合并出来的：它们曾各自抄了一份 createRuntime / walk /
// textOf / row / role / secondRole / statePayload / mountPanel，非空行有 481 行
// 逐字相同。合并以 p1 的版本为超集（多了定时器压缩、AbortController、scope 计数），
// 再把 p0 独有的 probeSwitchCheckbox / clickSwitchCheckbox / reloadWith 一并挂到 panel 上。
//
// 夹具是手写的合成数据，字段名逐个对齐 3099 真机 /state 回包（见
// Docs/teams 下的运行时实测与批次实施记录），不含任何本机路径。

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_FILE = path.resolve(HERE, '..', '..', 'lib', 'client.js')
import { deferred } from './client-runtime-host.mjs'

export function walk(node, visit) {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node !== 'object') return
  visit(node)
  for (const child of node.children) walk(child, visit)
}

export function textOf(node) {
  const parts = []
  const collect = (value) => {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) {
      for (const child of value) collect(child)
      return
    }
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(String(value))
      return
    }
    for (const child of value.children) collect(child)
  }
  collect(node)
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// 夹具：/state 回包同形数据
// ---------------------------------------------------------------------------
export function row(id, category, name, disabled = false) {
  return {
    id,
    path: id,
    parent: null,
    name,
    group: false,
    category,
    templateDisabled: disabled,
    disabled,
    hasOverride: false,
    configurable: true,
    templateConfig: null,
    config: null,
    isolate: null,
  }
}

export function role(overrides = {}) {
  return {
    id: 'team-select',
    name: '探查员',
    description: '收集资料',
    order: 1,
    mode: 'standard',
    overrides: {},
    capabilities: { mcp: { deny: [] }, toolGate: { deny: [] } },
    skills: { mode: 'pick', ids: [], dirs: [], missing: [], hasFilesystemRow: true, hasToolRow: true },
    agentsMd: { source: 'C:\\fake\\team-select\\AGENTS.md', copiedAt: '2026-01-01T00:00:00.000Z', dshHome: 'C:\\fake\\team-select', linked: true, hasRow: true },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    presetId: 'team-select',
    modeLabel: '标准模式',
    modeAvailable: true,
    dir: 'C:\\fake\\team-select',
    roleFile: 'C:\\fake\\team-select\\role.json',
    agentsMdFile: 'C:\\fake\\team-select\\AGENTS.md',
    rows: [row('persona', 'agents-md', '@deepseek-ai/dsh-persona', false), row('tool-bash', 'tool', '@deepseek-ai/dsh-tool-bash', true)],
    ...overrides,
  }
}

export function secondRole() {
  return role({
    id: 'team-devtest',
    name: '开发测试',
    description: '开发与测试',
    order: 2,
    presetId: 'team-devtest',
    dir: 'C:\\fake\\team-devtest',
    roleFile: 'C:\\fake\\team-devtest\\role.json',
    agentsMdFile: 'C:\\fake\\team-devtest\\AGENTS.md',
    rows: [row('persona', 'agents-md', '@deepseek-ai/dsh-persona', false)],
  })
}

export function statePayload(roles = [role(), secondRole()], extra = {}) {
  return {
    dir: 'C:\\fake',
    file: 'C:\\fake\\roles.json',
    presetPrefix: 'team-',
    platform: 'web',
    bindMembers: false,
    bindMembersSource: 'none',
    team: { enabled: false, available: true },
    hideChatTab: false,
    template: { presetId: 'standard', file: 'C:\\fake\\standard.patch.yml', extractedAt: '2026-01-01T00:00:00.000Z', rowCount: 2 },
    modes: [{ id: 'standard', label: '标准模式', description: null, available: true, source: 'bundled', file: 'C:\\fake\\standard.patch.yml', rowCount: 2 }],
    notes: { values: {}, custom: [], error: null },
    notesFile: 'C:\\fake\\notes.json',
    mcp: {
      file: 'C:\\fake\\mcp.json',
      error: null,
      services: [
        { key: 'json-demo', serverName: 'demo', label: 'Demo', transport: 'stdio', enabled: true, target: 'npx' },
        { key: 'json-other', serverName: 'other', label: 'Other', transport: 'stdio', enabled: false, target: 'npx' },
      ],
    },
    skills: {
      roots: [{ id: 'builtin', label: '内置', path: 'C:\\fake\\skills', rank: 1, exists: true }],
      available: [{ name: 'demo-skill', description: '演示', label: 'demo-skill', kind: 'skill', dir: 'C:\\fake\\skills\\demo-skill', file: 'C:\\fake\\skills\\demo-skill\\SKILL.md', root: 'builtin', rootLabel: '内置' }],
      error: null,
      row: { filesystem: 'skill-filesystem', tool: 'tool-skill', plugin: 'skill-plugin', toolPlugin: 'tool-skill-plugin' },
    },
    toolGate: { error: null, tools: [{ name: 'demo-tool', description: '演示工具' }] },
    workdir: {
      source: { patch: 'C:\\fake\\cordis.patch.yml', profile: 'web', extractedAt: '2026-01-01T00:00:00.000Z' },
      standard: { id: 'agent-loop', name: '@deepseek-ai/dsh-agent-loop', config: { agents: [], maxParallelToolCalls: 5 }, disabled: false },
    },
    registered: roles.map((item) => item.id),
    mounted: roles.map((item) => item.id),
    deferred: [],
    registry: roles.map((item) => ({ id: item.id })),
    registryError: null,
    roles,
    loaded: true,
    error: null,
    ...extra,
  }
}

export function jsonReply(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

// ---------------------------------------------------------------------------
// 面板装载：vm 求值 client.js → ctx 桩捕获 TeamRolesSection → 真渲染
// ---------------------------------------------------------------------------