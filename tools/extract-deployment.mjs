/**
 * Regenerate `lib/template/deployment.json` — the *deployment's own* rows that
 * a role can copy, currently just the `agent-loop` declaration.
 *
 * `tools/extract-template.mjs` snapshots the shipped `standard` preset. That
 * preset has no `agent-loop` row (§5.9: it lives only in the profile patch), so
 * "复制标准模式" has nothing to copy until this tool records what the profile
 * actually runs. The value is snapshotted rather than read at runtime because
 * the profile patch is YAML and this plugin ships no YAML parser — the plugin
 * would have to borrow dsh's own `js-yaml`, which is exactly the kind of
 * runtime dependency the standard snapshot exists to avoid.
 *
 * Usage:
 *   node tools/extract-deployment.mjs [path/to/cordis.patch.yml]
 *   node tools/extract-deployment.mjs --check [path/to/cordis.patch.yml]
 *
 * With no argument the profile is located under `<DSH_HOME>/profiles/*` — but
 * the snapshot's own recorded `source.patch` wins when that file still exists
 * and still lives under the same home. See `resolvePatch` for why.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseDeployment } from '../lib/deployment.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// `TEAM_DEPLOYMENT_SNAPSHOT` is a test seam: the tests must be able to point the
// tool at a throwaway snapshot, otherwise the "follow the recorded source" path
// below can never be driven (the shipped snapshot records a real profile path).
const OUT = process.env.TEAM_DEPLOYMENT_SNAPSHOT || path.join(HERE, '..', 'lib', 'template', 'deployment.json')
const LOOP_ID = 'agent-loop'
const LOOP_NAME = '@deepseek-ai/dsh-agent-loop'

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/** Every profile patch under the dsh home, `web` first so it wins a tie. */
async function candidatePatches() {
  const root = path.join(dshHome(), 'profiles')
  let entries = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => (left === 'web' ? -1 : right === 'web' ? 1 : left.localeCompare(right)))

  return names.map((name) => ({ profile: name, file: path.join(root, name, 'cordis.patch.yml') })).filter((candidate) => existsSync(candidate.file))
}

/** The dsh deployment that owns the profile — also where `js-yaml` lives. */
function locateRequireAnchor(patchPath) {
  let dir = path.dirname(patchPath)
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, 'package.json'))) return path.join(dir, 'package.json')
    dir = path.dirname(dir)
  }
  throw new Error(`no package.json above ${patchPath}`)
}

function loadYaml(patchPath) {
  const require = createRequire(locateRequireAnchor(patchPath))
  return require('js-yaml')
}

/**
 * `!!js <expr>` → `{ __js__: '<expr>' }`.
 *
 * A profile patch may carry `!!js` (its own header says so, and `cordis.patch.yml`
 * does once a preset is copied into it), but plain `js-yaml` throws
 * `unknown tag !<tag:yaml.org,2002:js>` on it. The tag has to be registered here
 * or this tool cannot read the very deployment it documents. Nothing in an
 * `agent-loop` row is gated, so the placeholder value is never consumed.
 */
function schemaWithJs(yaml) {
  return yaml.DEFAULT_SCHEMA.extend([
    new yaml.Type('tag:yaml.org,2002:js', {
      kind: 'scalar',
      resolve: (data) => typeof data === 'string' && data.length > 0,
      construct: (data) => ({ __js__: data }),
    }),
  ])
}

/** The patch's `agent-loop` row as a composition row, or `null`. */
export function loopRowFromPatch(rows) {
  if (!Array.isArray(rows)) return null
  const row = rows.find((entry) => entry !== null && typeof entry === 'object' && (entry.id === LOOP_ID || entry.name === LOOP_NAME))
  if (row === undefined) return null
  return {
    id: String(row.id ?? LOOP_ID),
    name: String(row.name ?? LOOP_NAME),
    config: row.config !== null && typeof row.config === 'object' ? row.config : {},
    disabled: row.disabled === true,
  }
}

/**
 * The patch this snapshot was extracted from, when that path is still usable.
 *
 * Returns `null` unless the recorded file exists *and* sits under the current
 * `<DSH_HOME>/profiles`. That second condition matters: the tests point
 * `DSH_HOME` at a temp directory, and honouring a recorded path from the real
 * home there would silently read the developer's profile instead of the fixture.
 */
async function recordedSource() {
  let source = null
  try {
    source = parseDeployment(await readFile(OUT, 'utf8')).source
  } catch {
    return null
  }
  const recordedPatch = source?.patch
  if (typeof recordedPatch !== 'string' || recordedPatch.length === 0) return null
  // The recorded source may be absolute (what a local regeneration writes) or
  // relative to `<DSH_HOME>` (what ships in the repository). The relative form
  // is what keeps the snapshot portable across machines AND keeps the author's
  // user name out of the published package.
  const file = path.isAbsolute(recordedPatch) ? recordedPatch : path.join(dshHome(), recordedPatch)
  if (!existsSync(file)) return null

  const root = path.join(dshHome(), 'profiles')
  const relative = path.relative(root, file)
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) return null

  const recorded = source.profile
  const profile = typeof recorded === 'string' && recorded.length > 0 ? recorded : path.basename(path.dirname(file))
  return { profile, file }
}

async function resolvePatch(explicit) {
  if (explicit) return { profile: null, file: path.resolve(explicit) }

  // Follow the recorded source before scanning. It is the only target that can
  // answer "has *this* deployment drifted?" — a scan cannot, because two
  // profiles may legitimately disagree and then there is no answer at all.
  // That happened for real: on 2026-09-29 `web` was raised to
  // `maxParallelToolCalls: 10` while `teamtest` stayed at 5, and the no-argument
  // form — which `npm test` ends with — could no longer run on this machine.
  const recorded = await recordedSource()
  if (recorded !== null) return recorded

  const candidates = await candidatePatches()
  if (candidates.length === 0) throw new Error(`no cordis.patch.yml under ${path.join(dshHome(), 'profiles')}; pass one as the first argument`)

  const yaml = loadYaml(candidates[0].file)
  /** @type {{ profile: string, file: string }[]} */
  const declaring = []
  /** @type {{ profile: string, file: string, row: object }[]} */
  const disagreeing = []
  /** @type {object | null} */
  let row = null

  for (const candidate of candidates) {
    const document = yaml.load(await readFile(candidate.file, 'utf8'), { schema: schemaWithJs(yaml) })
    const candidateRow = loopRowFromPatch(document)
    if (candidateRow === null) continue
    declaring.push(candidate)
    if (row === null) row = candidateRow
    else if (JSON.stringify(row) !== JSON.stringify(candidateRow)) disagreeing.push({ ...candidate, row: candidateRow })
  }

  if (declaring.length === 0) {
    throw new Error(`no profile patch declares ${LOOP_ID}: ${candidates.map((candidate) => candidate.file).join(', ')}`)
  }

  // Several profiles declaring the *same* row is not ambiguity: it is one
  // deployment with one value, and the first profile (`web`) is the tie-break
  // this file always documented. Refusing to run made `--check` un-runnable on
  // any machine with a second profile — this one has `web` and `teamtest`, so
  // both forms of the command failed. Only profiles that genuinely disagree
  // still need an explicit choice, and now they say which value they hold.
  if (disagreeing.length > 0) {
    const lines = [`profiles disagree about ${LOOP_ID}; pass one explicitly:`]
    lines.push(`  ${declaring[0].file}: ${JSON.stringify(row)}`)
    for (const entry of disagreeing) lines.push(`  ${entry.file}: ${JSON.stringify(entry.row)}`)
    throw new Error(lines.join('\n'))
  }

  return declaring[0]
}

/**
 * What actually differs between the snapshot's `loop` and the patch's.
 *
 * The comparison must ignore the provenance fields (`patch`, `profile`) —
 * including them makes the two forms disagree by construction: the explicit-path
 * branch sets `profile: null`, which can never equal the snapshot's profile name,
 * and the diff then always shows `loop: X → X`, the one field
 * that did *not* change. Content is the only thing that can drift; where it
 * was read from is a note, not a failure.
 *
 * @param {object | null} before - `loop` as recorded in `deployment.json`
 * @param {object | null} after - `loop` as the patch declares it
 * @returns {string | null} a description of the drift, or `null` when in sync
 */
export function describeLoopDrift(before, after) {
  const left = before ?? null
  const right = after ?? null
  if (JSON.stringify(left) === JSON.stringify(right)) return null
  if (left === null) return `loop: missing in the snapshot → ${JSON.stringify(right)}`
  if (right === null) return `loop: ${JSON.stringify(left)} → missing in the patch`

  const fields = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
  const changed = fields.filter(
    (field) => JSON.stringify(left[field]) !== JSON.stringify(right[field]),
  )
  return changed
    .map((field) => `loop.${field}: ${JSON.stringify(left[field])} → ${JSON.stringify(right[field])}`)
    .join('\n  ')
}

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const explicit = args.find((arg) => arg !== '--check')

let patch
try {
  patch = await resolvePatch(explicit)
} catch (error) {
  // 开源移植性：`--check` 在**找不到可比对的部署**时必须可见地跳过，而不是把
  // `npm test` 弄红。新用户的机器上 profile 补丁里可能根本没有 `agent-loop` 行
  // （它不是运行本插件的必要条件），此时没有「漂移」可言。仍然给一行 SKIP 说明，
  // 不做静默通过；重新生成（不带 --check）依旧严格报错。
  //
  // 只放过「没有答案可判」的两种情形；`profiles disagree` 是真歧义（两个 profile
  // 给出不同的值），必须继续报错 —— 让用户自己指定要比替用户猜一个安全。
  const noAnswer = /no cordis\.patch\.yml under|no profile patch declares/.test(String(error?.message ?? ''))
  if (checkOnly && noAnswer) {
    console.log(`--check: SKIP — no dsh deployment to compare against (${error.message})`)
  } else {
    throw error
  }
}
/**
 * Provenance is a note, and a note must not leak the author's home directory
 * into a published package: a path under `<DSH_HOME>` is recorded relative to
 * it (portable, resolvable on any machine), anything else stays absolute.
 */
function portablePatch(file) {
  const relative = path.relative(dshHome(), file)
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) return file
  return relative
}

// 没有可比的部署时到此为止：上面已经打印了 SKIP 说明。
async function compareOrWrite(patch) {
const yaml = loadYaml(patch.file)
const document = yaml.load(await readFile(patch.file, 'utf8'), { schema: schemaWithJs(yaml) })
const loop = loopRowFromPatch(document)

const snapshot = {
  $comment:
    'Generated by tools/extract-deployment.mjs — do not edit by hand. ' +
    'The deployment rows a role may copy; currently only the `agent-loop` declaration.',
  source: {
    patch: portablePatch(patch.file),
    profile: patch.profile,
    extractedAt: new Date().toISOString(),
  },
  loop,
}

if (checkOnly) {
  // 开源移植性：补丁里没有 `agent-loop` 行时没有「漂移」可言 —— 别人的机器上
  // 这一行本来就不是运行本插件的必要条件。可见地跳过，不把 `npm test` 弄红。
  if (loop === null) {
    console.log(`--check: SKIP — ${patch.file} declares no ${LOOP_ID} row to compare`)
    process.exitCode = 0
  } else {
  let existing = null
  try {
    existing = parseDeployment(await readFile(OUT, 'utf8'))
  } catch (error) {
    console.log(`--check: cannot read ${OUT} (${error.code ?? error.message}); run without --check first`)
    process.exitCode = 1
  }
  if (existing !== null) {
    // `$comment`, `extractedAt`, and which patch the row was read from are
    // provenance, not content: comparing them reported drift on every run.
    const drift = describeLoopDrift(existing.loop, loop)
    if (drift === null) {
      console.log(`--check: in sync with ${patch.file}${loop === null ? ' (no agent-loop row)' : ''}`)
      const recorded = existing.source?.patch ?? null
      const recordedFile =
        typeof recorded === 'string' && recorded.length > 0
          ? path.isAbsolute(recorded)
            ? recorded
            : path.join(dshHome(), recorded)
          : null
      if (recordedFile !== null && recordedFile !== patch.file) {
        console.log(`  note: the snapshot records ${recorded} as its source; the row itself is identical`)
      }
    } else {
      console.log(`--check: ${OUT} differs from ${patch.file}:`)
      console.log(`  ${drift}`)
      console.log('  run without --check to regenerate, then review the diff')
      process.exitCode = 1
    }
  }
  }
} else {
  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  console.log(`deployment.json written: loop=${loop === null ? 'none' : LOOP_ID}, from ${patch.file}`)
}
}

if (patch !== undefined) await compareOrWrite(patch)
