/**
 * 面板说明文字的默认值：说明现在是数据而不是代码。
 *
 * 默认值在 DEFAULT_NOTES 里，一个键一条；<dir>/notes.json（与 roles.json 同目录）
 * 可以覆盖其中任意子集，所以「改 json → 点刷新」就能换掉面板文字，不用重启。
 *
 * @module dsh-agent-team-roles/notes
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const NOTES_FILE = 'notes.json'

/** 面板显示的全部说明，按出现顺序排。
 * 键故意是平的：notes.json 要能一眼搜索、手改，嵌套形状只是多一层仪式。 */
export const DEFAULT_NOTES = {
  // ---- 顶栏 ----
  refresh:
    '重新读磁盘上的角色文件（roles.json 与各角色的 role.json / AGENTS.md），再同步一次预设。说明文字来自 notes.json，缺失的键用插件内置的那份。',
  exportNotes:
    '把当前用的说明文字整个写到 {file}（已经在那份文件里的键不会被覆盖），之后改那一份 json 就能集中改这些说明。',

  // ---- 团队开关 ----
  hostStale: '宿主半还没重启，重启 dsh 后这个开关才可用。',
  teamOn: '团队运行时已开{version}；委派的成员按名字认领同名角色。',
  teamOff: '默认关。打开后 dsh 会把这个组合包选进 profile 的组合，团队协作工具随之出现。',
  teamUnavailable: '{reason}',
  teamForced: '插件配置里的 bindMembers 已强制打开成员绑定，这个开关关掉它也不受影响。',

  // ---- 群聊 tab ----
  chatTab: '关掉后群聊 tab 不再出现，配置与视图都还在；改完立即生效，不用刷新。',

  // ---- 角色新建 / 整体还原 / 删除 ----
  createRole:
    '新建一个角色 = 建一个属于它的目录：role.json（这个角色的全部开关）+ AGENTS.md（从主会话复制一份，之后只用这份）。新角色的模式默认是标准模式。角色 ID 同时决定成员名（去掉 team- 前缀），留空则按名字自动生成。',
  resetRole:
    '把模式、能力行、MCP 开关都还原成刚建好这个角色时的样子（模式回到标准模式）；保留名字 / 描述 / 这个角色自己的 AGENTS.md',
  deleteRole: '连这个角色的目录一起删（role.json 与 AGENTS.md 都会没）',
  roleMemberName:
    '成员名：{member}（spawn_teammate 用这个名字）。角色 ID 决定成员名：改 ID 等于换成员名，已经建好的成员不会跟着改名。',

  // ---- 模式 ----
  modeNoState: '宿主半还没重启，这次 /state 里还没有 modes 段。',
  modeIntro: '这个角色的能力行整体来自所选的模式（dsh 自带的或你自己建的 preset，插件只是引用）。',
  modeKeepsOverrides:
    '切换模式不改你在这个角色上做过的任何开关：覆盖是按行 id 存的，新模式里有同 id 的行就继续生效。',
  modeSnapshotMissing: '这个模式现在组不出来（部署里没有它的预设声明），暂时按标准模式组装。',
  modeMinimal:
    '极简模式只有 persona 与一个终端组：没有 agent-instructions 行，所以这个角色自己的 AGENTS.md 不会被读取，也没有上下文继承那一行可切。',

  // ---- 角色工作目录 ----
  workdirNoState: '宿主半还没重启，这次 /state 里还没有这一段。',
  workdirIntro:
    '这个角色的规则文件就是这个目录里的 AGENTS.md，直接去改它就行：dsh 已经把这个文件接到该角色的 agent-instructions 行上，不管任务在哪个目录跑都会加载它。',
  workdirSource: '（新建时复制自 {source}）',
  workdirNoSource: '（新建时没有可复制的来源，插件生成的空模板）',
  workdirWithLoop:
    '任务在哪个目录跑由新建任务时选的目录决定，预设改不了它；部署的 agent-loop 也是全局的（maxParallelToolCalls={parallel}，角色不能各自覆盖）。',
  workdirWithoutLoop: '任务在哪个目录跑由新建任务时选的目录决定，预设改不了它；本部署里没有 agent-loop 行。',
  workdirReset: '重新从主会话复制一份 AGENTS.md 覆盖这个角色目录里的文件，并清掉这个角色改过的 AGENTS.md 发现规则',
  workdirLinked: '规则文件已接入这个角色',
  workdirNoRow: '规则文件没接入：这个模式里没有 agent-instructions 行（见上面「模式」）',
  workdirUnlinked: '规则文件还没接入（角色条目异常）',

  // ---- 上下文继承 ----
  contextNoRow: '这个模式（{mode}）里没有 delegation/tool-subagent 这一行，这个角色没有可切换的委派工具。',
  contextOn: '开：委派走 fork provider —— 成员带上本会话已结束轮次的上下文。',
  contextOff: '关：委派走 spawn provider —— 成员是全新 Agent，零继承。',
  contextProvider:
    '（改的是模板里已有的 delegation/tool-subagent 行的 provider：{provider}；工具名不变，还是 subagent）',
  contextOtherTool:
    '这个角色的 subagent_fork 工具不受影响，模型需要时仍可自己选；这里只决定默认那个 subagent 的继承方式。',

  // ---- MCP ----
  mcpNoState:
    '宿主半还没重启，这次 /state 还没有 mcp 段——重启 dsh 后这里才会列出连接器里的 server。',
  mcpIntro: '取消勾选只是让这个角色看不见该 server 的工具（mcp__<名字>__*），连接器与其它角色都不受影响。',

// ---- 技能 ----
  skillsNoState:
    '宿主半还没重启，这次 /state 还没有 skills 段——重启 dsh 后这里才会列出技能。',
  skillsIntro:
    '勾上就是选用、取消就是不加载：勾选会把模式里已有的 skill-filesystem 行指向这些技能目录，原技能目录与预设文件都不动。',
  skillsHow: '继承（默认）= 跟以前一样，用这个模式自己的技能发现；只挂勾选的 = 用下面这份名单，没勾的不加载。',
  skillsGlobal: '全局层注册的技能（例如技能管理器自己提供的）对所有角色都可见，这一层筛不掉。',
  skillsReset: '把技能选择还原成「继承这个模式的默认技能」；已勾的名单会留着，方便再切回来。',

// ---- 插件可见性 ----
  toolGateNoState:
    '宿主半还没重启，这次 /state 还没有 toolGate 段——重启 dsh 后这里才会列出部署全局注册的工具。',
  toolGateIntro:
    '取消勾选 = 这个角色（以及它派生的成员）看不见这个工具：插件仍在运行，别的角色照旧。',
  toolGateVsRows:
    '和上面「工具」分组不是一回事：那一组是模式模板行，关掉等于**不挂载**整个插件；这里关掉的只是这个角色的可见性。',
  toolGateGroups:
    '名字前缀相同、且数量 ≥3 的自动归成一组（组头那个勾选框 = 整组一起开 / 关），其余平铺在外面。工具清单里没有「属于哪个插件」这个字段，所以只能按名字前缀分组。',
  toolGateScope:
    'MCP 的工具由上面的 MCP 开关按 server 整片管；run_code 注册表不允许遮蔽。这两类都不在下面这份名单里。',

  // ---- 能力行 ----
  rows: [
    '这一列的行整体来自部署的 {mode} 模式模板（插件在构建时抽的快照，运行时只引用它）。',
    '每一行右边的勾选开关是「这个角色是否启用这一行」；改过的行左侧会有一条竖线。',
    '分组行（例如 persistent-shell）可以整组开关；组声明了 isolate 时那一行会标出来 —— 它只影响服务落在哪个 realm，不影响开关。',
    '平台门控已按 {platform} 解析。勾选框显示的是勾选即启用；左侧竖线表示该行被角色覆盖过。',
    '表里就是这个角色当前模式（见上面「模式」）的全部行；MCP 开关在角色详情里单独列出，因为四个模式里都没有这类行，它由连接器的连接生成。',
  ].join('\n'),
  rowsReset: '把所有行的开关与覆盖还原成 {mode} 模式模板的样子（MCP 开关与插件名单也一起清掉）',
}

/** notes.json 可以设置的键，供 README 与 export-notes 用。 */
export const NOTE_KEYS = Object.keys(DEFAULT_NOTES)

/** notes.json 与 roles.json 同目录，一个目录装全部配置。 */
export function notesPath(dir) {
  return path.join(dir, NOTES_FILE)
}

/** 只保留非空字符串：手改的 json 可能有尾逗号或嵌套对象，任何一个都不该把面板弄坏。 */
function normalizeNotes(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return {}
  const notes = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (text.length === 0) continue
    notes[key] = text
  }
  return notes
}

/** 每次调用都重读 <dir>/notes.json，这就是「改 json → 点刷新」不用重启也能生效的原因。
 * @returns {Promise<{file: string, values: Record<string, string>, custom: string[], error: string|null}>} */
export async function loadNotes(dir) {
  const file = notesPath(dir)
  const result = { file, values: { ...DEFAULT_NOTES }, custom: [], error: null }
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (failure) {
    if (failure !== null && failure !== undefined && failure.code === 'ENOENT') return result
    result.error = String((failure && failure.message) || failure)
    return result
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (failure) {
    result.error = `notes.json 不是合法 JSON：${String((failure && failure.message) || failure)}`
    return result
  }
  const overrides = normalizeNotes(parsed)
  for (const [key, value] of Object.entries(overrides)) {
    result.values[key] = value
    result.custom.push(key)
  }
  return result
}

/** 把无法解析的 notes.json 备份到它旁边，让拒绝导出时用户仍有一条退路；原文件不动。
 * @param {string} dir 插件数据目录 @param {string} file 现有 notes.json 路径 @param {Buffer} raw 原始字节
 * @returns {Promise<string>} 备份路径 */
async function setAsideCorruptNotes(dir, file, raw) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${file}.corrupt-${stamp}`
  await mkdir(dir, { recursive: true })
  await writeFile(backup, raw)
  return backup
}

/** 一次性写出整张表，用户就有一份列全所有键的文件。
 * 文件里已有的键优先：导出绝不能悄悄丢掉用户已经改过的内容。所以存在但解析失败的文件
 * 不算「缺失」——备份到旁边并拒绝导出，保住用户的字节。 */
export async function exportNotes(dir) {
  const file = notesPath(dir)
  let raw = null
  try {
    raw = await readFile(file)
  } catch (failure) {
// 只有文件不存在才算「没有要保留的」；权限错误、路径是目录之类都不能报成创建成功。
    if (failure === null || failure === undefined || failure.code !== 'ENOENT') throw failure
  }

  let existing = {}
  if (raw !== null) {
    const refuse = async (detail) => {
      const backup = await setAsideCorruptNotes(dir, file, raw)
      const error = new Error(
        `${detail}，导出已中止；原文件未改动，已备份为 ${path.basename(backup)}`,
      )
      error.status = 409
      throw error
    }
    let parsed
    try {
      parsed = JSON.parse(raw.toString('utf8'))
    } catch (failure) {
      await refuse(`notes.json 不是合法 JSON：${String((failure && failure.message) || failure)}`)
    }
// 解析成功但形状不对：null / [] / "hello" 都是合法 JSON 却不带任何覆盖，
// 旧逻辑会用默认值盖掉用户的文件并报成一次正常替换。
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const shape = parsed === null ? 'null' : (Array.isArray(parsed) ? '数组' : typeof parsed)
      await refuse(`notes.json 必须是一个 JSON 对象，实际是 ${shape}`)
    }
    existing = normalizeNotes(parsed)
  }

  const merged = { ...DEFAULT_NOTES, ...existing }
  await mkdir(dir, { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
  return {
    file,
    keys: Object.keys(merged),
    created: raw === null,
    replaced: raw !== null,
    corrupt: false,
  }
}
