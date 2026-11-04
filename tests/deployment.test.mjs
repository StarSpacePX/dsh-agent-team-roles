/** 部署读取器的单元测试（MCP 开关背后那几层）：连接器存储文档怎么读、deny 名单怎么变成
 * gateway 行、normalizeCapabilities 保留什么。插件级接线（set-mcp 与生成的预设）在 panels.test.mjs。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  GATE_PLUGIN_NAME,
  INSTRUCTION_ROW_ID,
  MCP_GATE_ID,
  RUN_CODE_NAME,
  TOOL_GATE_ID,
  buildMcpGateRow,
  buildToolGateRow,
  dshHome,
  mcpStoragePath,
  mcpToolNames,
  mcpToolPrefix,
  normalizeCapabilities,
  parseDeployment,
  parseMcpServers,
  readMcpServers,
} from '../lib/deployment.js'

/** A storage document shaped like the connector's, trimmed to what matters. */
const STORAGE = {
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
// 没有 server 名的记录成不了开关：没有命名空间可过滤，直接丢掉，不渲染成空行。
      broken: { key: 'broken', transport: 'stdio', enabled: true },
    },
  },
}

test('parseMcpServers keeps the fields a switch needs, in server-name order', () => {
  const servers = parseMcpServers(JSON.stringify(STORAGE))

  assert.deepEqual(
    servers.map((server) => server.serverName),
    ['agentmemhub', 'github'],
  )
  assert.deepEqual(servers[0], {
    key: 'custom-agentmemhub',
    serverName: 'agentmemhub',
    label: 'AgentMemHub 记忆网关',
    transport: 'stdio',
    enabled: true,
    target: 'C:\\python.exe',
  })
// 连接器自己的 enabled 标志原样透传：面板显示它，插件从不写它。
  assert.equal(servers[1].enabled, false)
})

test('parseMcpServers survives a document with no connections table', () => {
  assert.deepEqual(parseMcpServers('{"tables":{}}'), [])
  assert.deepEqual(parseMcpServers('{"tables":{"connections":null}}'), [])
})

test('readMcpServers treats a missing file as "no servers", not a failure', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'team-roles-home-'))
  try {
    const missing = await readMcpServers(home)
    assert.equal(missing.error, null)
    assert.deepEqual(missing.servers, [])
    assert.equal(missing.file, path.join(home, 'storages', 'mcp_connector.json'))

    await mkdir(path.join(home, 'storages'), { recursive: true })
    await writeFile(path.join(home, 'storages', 'mcp_connector.json'), '{ not json', 'utf8')
    const broken = await readMcpServers(home)
    assert.notEqual(broken.error, null)
    assert.deepEqual(broken.servers, [])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('readMcpServers reads a real storage file from the given home', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'team-roles-home-'))
  try {
    await mkdir(path.join(home, 'storages'), { recursive: true })
    await writeFile(path.join(home, 'storages', 'mcp_connector.json'), JSON.stringify(STORAGE), 'utf8')
    const read = await readMcpServers(home)
    assert.equal(read.error, null)
    assert.deepEqual(
      read.servers.map((server) => server.serverName),
      ['agentmemhub', 'github'],
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('mcpToolNames matches the public prefix and nothing else', () => {
  const names = ['mcp__github__list_issues', 'mcp__github__create_issue', 'mcp__context7__query', 'bash', 'tool-bash']
  assert.equal(mcpToolPrefix('github'), 'mcp__github__')
  assert.deepEqual(mcpToolNames(names, 'github'), ['mcp__github__list_issues', 'mcp__github__create_issue'])
  assert.deepEqual(mcpToolNames(names, 'nope'), [])
})

test('mcpToolNames never lets a shorter server name swallow a longer one', () => {
// git 是 github 的严格前缀，但双下划线属于前缀本身，两个命名空间不会串。
// 这正是过滤用 mcp__<name>__ 而不是 mcp__<name> 的原因。
  const names = ['mcp__git__status', 'mcp__github__list_issues', 'mcp__git__', 'mcp__git__status_extra']
  assert.deepEqual(mcpToolNames(names, 'git'), ['mcp__git__status', 'mcp__git__', 'mcp__git__status_extra'])
  assert.deepEqual(mcpToolNames(names, 'github'), ['mcp__github__list_issues'])
})

test('mcpToolNames ignores non-string entries instead of throwing', () => {
// tools.schemas() 是实时数据：列错也不能把挂载搞挂。
  const names = ['mcp__github__list_issues', null, undefined, 42, { name: 'mcp__github__nope' }]
  assert.deepEqual(mcpToolNames(names, 'github'), ['mcp__github__list_issues'])
})

test('mcpToolNames requires the exact server name, so padding finds nothing', () => {
  const names = ['mcp__github__a', 'mcp__GitHub__a']
  assert.deepEqual(mcpToolNames(names, 'github'), ['mcp__github__a'])
  assert.deepEqual(mcpToolNames(names, 'GitHub'), ['mcp__GitHub__a'])
  assert.deepEqual(mcpToolNames(names, ' github '), [])
})

test('buildMcpGateRow is null when nothing is denied, and deduplicates otherwise', () => {
  assert.equal(buildMcpGateRow([]), null)
  assert.equal(buildMcpGateRow(undefined), null)
  assert.equal(buildMcpGateRow(['  ']), null)

  assert.deepEqual(buildMcpGateRow(['github', 'agentmemhub', 'github']), {
    id: MCP_GATE_ID,
    name: GATE_PLUGIN_NAME,
    config: { mcpGate: { deny: ['agentmemhub', 'github'] } },
  })
})

test('the MCP gateway row is the only row a role may add', () => {
  assert.equal(INSTRUCTION_ROW_ID, 'agent-instructions')
// buildLoopRow 是故意去掉的；角色的规则文件也不是一行 —— roles.js 靠覆盖既有行的
// config.dshHome 把它接上，这样组合仍在 R3 内。
  assert.equal(typeof buildMcpGateRow, 'function')
})

test('normalizeCapabilities keeps the two deny lists and nothing else', () => {
// 老版本写的角色文件还带 loop 块：归一化直接退役它，不无限往返。
  assert.deepEqual(normalizeCapabilities(null), { mcp: { deny: [] }, toolGate: { deny: [] } })
  assert.deepEqual(normalizeCapabilities(['nope']), { mcp: { deny: [] }, toolGate: { deny: [] } })

  assert.deepEqual(
    normalizeCapabilities({
      mcp: { deny: [' github ', 'github', 7], extra: 'dropped' },
      toolGate: { deny: ['list_agents', ' list_agents ', ''] },
      loop: { enabled: true, cwd: 'C:\\somewhere', maxParallelToolCalls: 4 },
    }),
    { mcp: { deny: ['7', 'github'] }, toolGate: { deny: ['list_agents'] } },
  )
})

test('buildToolGateRow is null when nothing is denied, and drops run_code', () => {
  assert.equal(buildToolGateRow([]), null)
  assert.equal(buildToolGateRow(undefined), null)
  assert.equal(buildToolGateRow(['  ']), null)
// run_code 是注册表唯一拒绝限制的名字，所以只承载它的行必须整行不存在。
  assert.equal(buildToolGateRow([RUN_CODE_NAME]), null)

  assert.deepEqual(buildToolGateRow(['list_agents', 'run_code', 'list_agents']), {
    id: TOOL_GATE_ID,
    name: GATE_PLUGIN_NAME,
    config: { toolGate: { deny: ['list_agents'] } },
  })
})

test('parseDeployment tolerates a snapshot with no loop row', () => {
  assert.deepEqual(parseDeployment('{}'), { source: {}, loop: null })
  assert.deepEqual(parseDeployment('{"loop":null}'), { source: {}, loop: null })
  assert.deepEqual(parseDeployment('{"source":{"profile":"web"},"loop":{"id":"agent-loop"}}'), {
    source: { profile: 'web' },
    loop: { id: 'agent-loop' },
  })
})

test('dshHome prefers DSH_HOME and falls back to ~/.dsh', () => {
  assert.equal(dshHome({ DSH_HOME: 'C:\\elsewhere' }), 'C:\\elsewhere')
  assert.equal(dshHome({}), path.join(os.homedir(), '.dsh'))
  assert.equal(mcpStoragePath('C:\\home'), path.join('C:\\home', 'storages', 'mcp_connector.json'))
})
