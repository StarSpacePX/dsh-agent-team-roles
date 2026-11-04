/**
 * Unit tests for the deployment readers behind the MCP switch.
 *
 * These cover the parts that never touch Cordis: how the connector's storage
 * document is read, how a deny list becomes a gateway row, and what
 * `normalizeCapabilities` keeps. The plugin-level wiring (the `set-mcp` action
 * and the resulting preset) is exercised in `tests/plugin/panels.test.mjs`.
 *
 * There are deliberately **no** loop-row tests here any more (§5.30): this module
 * no longer builds one, because `agent-loop` owns the process-wide agent-factory
 * slot and a preset carrying it fails to mount. The one test that remains about
 * loop is `parseDeployment`, which still has to read a snapshot that mentions it.
 */
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
      // A record without a server name cannot become a switch: there is no
      // namespace to filter, so it is dropped instead of rendered as a blank row.
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
  // The connector's own enabled flag is carried through untouched — the panel
  // shows it, the plugin never writes it.
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
  // `git` is a strict prefix of `github`, but the double underscore is part of the
  // prefix, so the two namespaces cannot bleed into each other. This is the whole
  // reason the filter uses `mcp__<name>__` and not `mcp__<name>`.
  const names = ['mcp__git__status', 'mcp__github__list_issues', 'mcp__git__', 'mcp__git__status_extra']
  assert.deepEqual(mcpToolNames(names, 'git'), ['mcp__git__status', 'mcp__git__', 'mcp__git__status_extra'])
  assert.deepEqual(mcpToolNames(names, 'github'), ['mcp__github__list_issues'])
})

test('mcpToolNames ignores non-string entries instead of throwing', () => {
  // `tools.schemas()` is live data: a malformed listing must not take the mount down.
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
  // `buildLoopRow` is gone on purpose (§5.30). A role's instruction file is not
  // a row either — `roles.js` wires it by overriding this existing row's
  // `config.dshHome`, which is what keeps the composition inside R3.
  assert.equal(typeof buildMcpGateRow, 'function')
})

test('normalizeCapabilities keeps the two deny lists and nothing else', () => {
  // A role file written by an older version still carries a `loop` block; the
  // normalizer retires it instead of round-tripping it forever.
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
  // `run_code` is the one name the registry refuses to restrict, so a row that
  // carries nothing else must not exist at all.
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
