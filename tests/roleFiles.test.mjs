/**
 * Unit tests for the files a role owns.
 *
 * The interesting part is not the string juggling: it is *which* file a new role
 * copies its rules from. It is fixed: the user-global `$DSH_HOME/AGENTS.md`, and
 * nothing else (§5.42; user m10123 → m10519: 「这个是固定复制的…项目文件有啥好复制的」).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  AGENTS_MD_FILE,
  ROLE_FILE,
  agentsMdFile,
  createAgentsMd,
  pickAgentsMdSource,
  removeRoleDir,
  roleDir,
  roleFile,
} from '../lib/roleFiles.js'

/** Run against a throwaway data directory and a throwaway "workspace". */
async function withSandbox(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'team-roles-files-'))
  const dir = path.join(root, 'data')
  const cwd = path.join(root, 'workspace')
  const home = path.join(root, 'home')
  await mkdir(cwd, { recursive: true })
  await mkdir(home, { recursive: true })
  try {
    await run({ root, dir, cwd, home })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('role files all live inside the role directory', () => {
  assert.equal(roleDir('C:\\data', 'team-a'), path.join('C:\\data', 'team-a'))
  assert.equal(roleFile('C:\\data', 'team-a'), path.join('C:\\data', 'team-a', ROLE_FILE))
  assert.equal(agentsMdFile('C:\\data', 'team-a'), path.join('C:\\data', 'team-a', AGENTS_MD_FILE))
})

test('a new role copies the fixed user-global AGENTS.md', async () => {
  await withSandbox(async ({ cwd, home }) => {
    // Nothing at home yet: the caller seeds a fresh editable file instead.
    assert.equal(await pickAgentsMdSource({ home }), null)

    await writeFile(path.join(home, 'AGENTS.md'), '# global\n- use pnpm\n', 'utf8')
    assert.equal(await pickAgentsMdSource({ home }), path.join(home, 'AGENTS.md'))

    // A workspace file changes nothing: a member that enters a project reads
    // that project's AGENTS.md live, so there is nothing to snapshot.
    await writeFile(path.join(cwd, 'AGENTS.md'), '# project\n- keep it short\n', 'utf8')
    await writeFile(path.join(cwd, 'CLAUDE.md'), '# claude\n- be brief\n', 'utf8')
    assert.equal(await pickAgentsMdSource({ cwd, home }), path.join(home, 'AGENTS.md'))
  })
})

test('the 10-byte workspace placeholder never mattered (m10123 / m10519)', async () => {
  await withSandbox(async ({ cwd, home }) => {
    await writeFile(path.join(home, 'AGENTS.md'), '# 用户全局规则\n- 始终使用 PowerShell\n', 'utf8')

    // The file that made new roles look empty: it exists, is not empty, and
    // says nothing — and it is irrelevant now, because nothing looks at it.
    await writeFile(path.join(cwd, 'AGENTS.md'), '\n#  暂无\n', 'utf8')
    assert.equal(await pickAgentsMdSource({ cwd, home }), path.join(home, 'AGENTS.md'))
  })
})

test('an empty user-global file is not a source either', async () => {
  await withSandbox(async ({ home }) => {
    await writeFile(path.join(home, 'AGENTS.md'), '', 'utf8')
    assert.equal(await pickAgentsMdSource({ home }), null)
  })
})

test('createAgentsMd copies the source into the role directory', async () => {
  await withSandbox(async ({ dir, cwd }) => {
    const source = path.join(cwd, 'AGENTS.md')
    await writeFile(source, '# project rules\n', 'utf8')

    const created = await createAgentsMd({ dir, id: 'team-a', source })
    assert.deepEqual(created, {
      file: path.join(dir, 'team-a', 'AGENTS.md'),
      source,
      copied: true,
    })
    assert.equal(await readFile(created.file, 'utf8'), '# project rules\n')

    // The copy is a copy: editing it leaves the original alone.
    await writeFile(created.file, '# mine\n', 'utf8')
    assert.equal(await readFile(source, 'utf8'), '# project rules\n')
  })
})

test('createAgentsMd seeds an editable file when there is nothing to copy', async () => {
  await withSandbox(async ({ dir }) => {
    const created = await createAgentsMd({ dir, id: 'team-a', source: null })
    assert.equal(created.copied, false)
    assert.equal(created.source, null)
    const text = await readFile(created.file, 'utf8')
    assert.match(text, /team-a/)
    assert.match(text, /这个角色自己的规则文件/)
  })
})

test('removeRoleDir takes the whole directory and reports what it found', async () => {
  await withSandbox(async ({ dir }) => {
    await createAgentsMd({ dir, id: 'team-a', source: null })
    assert.equal(await removeRoleDir(dir, 'team-a'), true)
    await assert.rejects(() => stat(path.join(dir, 'team-a')))
    // Idempotent: a second delete is a no-op, not an error.
    assert.equal(await removeRoleDir(dir, 'team-a'), false)
  })
})
