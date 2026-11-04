/** 领域夹具：角色定义、假 teammate、假 loader、名册与任务事件……假环境本身在 ../harness.mjs。 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { TEAM_BUNDLE } from '../../lib/deployment.js'
import { SHIPPED_MODE_IDS, shippedPreset } from './shipped-presets.mjs'
import { createHarness, call } from './harness.mjs'
import os from 'node:os'
import path from 'node:path'

export function fakeChild(label, header = { parentSession: 'session-lead', origin: 'subagent' }, events) {
  return {
    id: 'session-member',
    session: {
      header,
// 真回包形状：对过本机 42 份子会话日志（{ version: 3, mode, provider: 'spawn', label, … }）。
      ownEvents: () =>
        events ?? [
          {
            type: 'subagent/descriptor',
            seq: 0,
            data: { version: 3, mode: 'continuable', provider: 'spawn', label },
          },
        ],
    },
  }
}

export const REVIEWER = {
  version: 1,
  roles: [{ id: 'team-reviewer', name: 'reviewer', description: '', order: 10, overrides: {} }],
}

/** The Lead that delegated the child, i.e. `params.parentAgent`. */

export const LEAD_AGENT = { id: 'session-lead' }

/** 走一遍创建窗口：create/resume 接受同一份 request，dsh 在调用内就 await request.setup（在 child 宣告之前），
 * 这正是角色能在那里选中的原因；假 create/resume 因此会跑组合好的 setup，把测试自己的 child 交出去。 */

export async function createMember(harness, options = {}) {
  const method = options.method ?? 'create'
  const child = options.child ?? fakeChild('reviewer')
  return harness.agents[method]({
    ...(method === 'resume' ? { resumeSessionId: 'session-member' } : { sessionId: 'session-member' }),
    parentAgent: LEAD_AGENT,
    ...(options.params ?? {}),
    setup: options.setup,
    child,
    childCtx: options.childCtx ?? {},
  })
}

export const CHINESE_ROLE = {
  version: 1,
  roles: [{ id: 'team-r1abc', name: '架构师', description: '', order: 10, overrides: {} }],
}

export const MCP_STORAGE_DOC = {
  unit: 'mcp_connector',
  global: {},
  tables: {
    connections: {
      'custom-agentmemhub': {
        key: 'custom-agentmemhub',
        serverName: 'agentmemhub',
        name: 'AgentMemHub 记忆网关',
        transport: 'stdio',
        enabled: true,
        command: 'C:\\python.exe',
      },
      'json-github': {
        key: 'json-github',
        serverName: 'github',
        name: 'github',
        transport: 'stdio',
        enabled: false,
        command: 'npx',
      },
    },
  },
}

export async function withHome(run) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'team-roles-home-'))
  try {
    await mkdir(path.join(home, 'storages'), { recursive: true })
    await writeFile(path.join(home, 'storages', 'mcp_connector.json'), JSON.stringify(MCP_STORAGE_DOC), 'utf8')
    await run(home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

/** The live definition of one role, as the registry would mount it. */

export function definitionOf(registered, id) {
  const record = registered.find((item) => item.id === id && !item.disposed)
  assert.ok(record, `preset not registered: ${id}`)
  return record.definition
}

export function fakeTools(names, restrictCalls = []) {
  return {
    schemas: () => names.map((entry) => (typeof entry === 'string' ? { name: entry, description: '' } : entry)),
    restrict: (patch) => {
      const record = { deny: [...patch.deny], disposed: false }
      restrictCalls.push(record)
      return () => {
        record.disposed = true
      }
    },
  }
}

export function fakePluginManager(row = {}) {
  const bundle = {
    name: TEAM_BUNDLE,
    version: '0.1.7-rc.2',
    description: 'Agent Teams collaboration, tools, and Web UI in one experimental bundle',
    enabled: row.enabled === true,
    installed: row.installed !== false,
    optional: false,
    removable: row.removable !== false,
    rows: [],
    overrides: [],
  }
  if (row.readOnlyReason !== undefined) bundle.readOnlyReason = row.readOnlyReason
  return {
    bundle,
    /** @type {{ name: string, enabled: boolean }[]} */
    calls: [],
// 部署的名册被问了几次。
    listCalls: 0,
    async listBundles() {
      this.listCalls += 1
      return [bundle, { name: '@deepseek-ai/dsh-web-app', enabled: true, installed: true, removable: true }]
    },
    async setBundleEnabled(name, enabled) {
      this.calls.push({ name, enabled })
      if (name !== TEAM_BUNDLE) throw new Error(`unexpected bundle ${name}`)
      if (row.error !== undefined) {
        return { changed: false, application: 'failed', stage: 'enable', target: name, enabled, error: row.error }
      }
      bundle.enabled = enabled
      return {
        changed: true,
        application: row.application ?? 'applied',
        stage: 'enable',
        target: name,
        enabled,
        ...(row.warnings === undefined ? {} : { warnings: row.warnings }),
      }
    },
  }
}

export function argumentText(source, open) {
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]
    if (char === "'" || char === '"' || char === '`') {
      index += 1
      while (index < source.length && source[index] !== char) {
        if (source[index] === '\\') index += 1
        index += 1
      }
      continue
    }
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, index)
    }
  }
  throw new Error('括号不配平')
}

/** 给 harness 用的 Loader 替身：真部署永远持有 dsh 自带的四份 preset，这里也照做（从 tests/fixtures/presets/ 读）。
 * 插件不再留副本；调用方声明排在前，所以用例可以遮蔽某份 shipped preset。 */
export function fakeLoader(declarations = [], options = {}) {
  const shipped = options.shipped === false ? [] : SHIPPED_MODE_IDS.map((id) => shippedPreset(id))
  return {
    entries: () =>
      [...declarations, ...shipped].map((declaration, index) => ({
        id: `entry-${index}`,
        options: { name: '@deepseek-ai/dsh-agent-preset', config: declaration },
      })),
  }
}

export function interpolateLikeDsh(text, variables = {}) {
  let result = ''
  let last = 0
  for (let open = text.indexOf('{{'); open >= 0; open = text.indexOf('{{', last)) {
    const match = /^\{\{([A-Za-z0-9_.-]+)\}\}/.exec(text.slice(open))
    if (match === null) {
      if (text.indexOf('}}', open + 2) >= 0) {
        throw new Error(`malformed prompt variable reference at "${text.slice(open, open + 16)}…"`)
      }
      result += text.slice(last, open + 2)
      last = open + 2
      continue
    }
    if (!Object.hasOwn(variables, match[1])) {
      throw new Error(`unknown prompt variable "{{${match[1]}}}"`)
    }
    result += text.slice(last, open) + variables[match[1]]
    last = open + match[0].length
  }
  return result + text.slice(last)
}
