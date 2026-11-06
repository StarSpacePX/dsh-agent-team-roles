/**
 * 状态投影与 `/state` 正文缓存。
 *
 * buildState() 是面板唯一的读入口：把角色存储、模式名册、部署快照、MCP 连接器、技能目录、
 * 说明书、团队开关与注册诊断拼成一份 JSON。另有它的两个包裹：replyState()（写已经落盘、
 * 渲染失败时的降级回包）与 buildStateCached()（同一份正文只构造一次，重复 GET 直接 304）。
 *
 * @module dsh-agent-team-roles/host/state
 */
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import {
  DEFAULT_MODE,
  describeRows,
  modeLabel,
  normalizeMode,
} from '../template.js'
import {
  INSTRUCTION_ROW_ID,
  MCP_TOOL_PREFIX,
  RUN_CODE_NAME,
  readMcpServers,
} from '../deployment.js'
import { loadNotes, notesPath } from '../notes.js'
import { LEAD_COLOR, ROLE_PALETTE, colorForRoleId, normalizeColor } from '../roleColor.js'
import { memberNameForRole } from '../roles.js'
import { normalizeModel } from '../storeRole.js'
import {
  SKILL_PLUGIN_NAME,
  SKILL_ROW_ID,
  SKILL_TOOL_PLUGIN_NAME,
  SKILL_TOOL_ROW_ID,
  normalizeSkills,
  resolveRoleSkillDirs,
  scanSkills,
} from '../skills.js'
import { bindingEnabled } from './config.js'
import { stateAfterWrite } from './http.js'

/** @param {object} h 共享宿主状态 @param {object} deps `{ modes, team, lifecycle }`
 * @returns {object} 状态投影 API */
export function createState(h, deps) {
  const { modes, team, lifecycle } = deps

/** 模型的候选来源：宿主 llm 目录里注册的 provider 与其模型。
 * 只读；拿不到就返回空表，面板退化成手填。 */
  const readModelCatalog = async () => {
    const llm = h.ctx?.get?.('llm') ?? null
    if (llm === null || llm === undefined || typeof llm.listProviders !== 'function') {
      return { error: 'llm 服务不可用，读不到模型清单', providers: [], reasoningEfforts: [] }
    }
    try {
      const providers = []
      for (const info of llm.listProviders()) {
        const id = String(info?.id ?? info?.name ?? '')
        if (id.length === 0) continue
        let models = []
        try {
          const listed = await llm.listModels(id)
          models = []
          for (const model of listed) {
            const modelId = String(model?.id ?? model?.name ?? '')
            if (modelId.length === 0) continue
            // 推理档位是适配器按「精确 provider/model」声明的（如 deepseek 的 off/low/high/max），
            // 不是全局固定档，所以必须逐模型问 resolveModelInfo。
            let efforts = []
            let defaultEffort = ''
            try {
              const resolved = await llm.resolveModelInfo?.(id, modelId)
              const reasoning = resolved?.reasoning
              if (Array.isArray(reasoning?.efforts)) {
                efforts = reasoning.efforts
                  .map((effort) => ({
                    id: String(effort?.id ?? ''),
                    name: String(effort?.name ?? effort?.id ?? ''),
                  }))
                  .filter((effort) => effort.id.length > 0)
              }
              defaultEffort = String(reasoning?.defaultEffort ?? '')
            } catch {
              // 单模型档位查不到不影响其它模型。
            }
            models.push({ id: modelId, label: String(model?.name ?? modelId), efforts, defaultEffort })
          }
        } catch {
// 单个 provider 列不出模型不影响其它 provider，用户仍可手填。
          models = []
        }
        providers.push({ id, label: String(info?.label ?? info?.name ?? id), models })
      }
      providers.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      return { error: null, providers }
    } catch (error) {
      return { error: String((error && error.message) || error), providers: [] }
    }
  }

/** 「插件」面板可选的全局工具：根作用域注册表里除 MCP 工具（按前缀归 MCP 面板挂载）
 * 与 run_code（注册表拒绝限制）之外的全部。 */
  const readToolGate = () => {
    const tools = h.rootTools
    if (tools === null || tools === undefined || typeof tools.schemas !== 'function') {
      return { error: 'tools 服务不可用，读不到工具清单', tools: [] }
    }
    try {
      const list = []
      for (const schema of tools.schemas()) {
        const name = schema === null || schema === undefined ? '' : String(schema.name ?? '')
        if (name.length === 0 || name === RUN_CODE_NAME) continue
        if (name.startsWith(MCP_TOOL_PREFIX)) continue
        const description = schema === null || schema === undefined ? '' : String(schema.description ?? '')
        list.push({
          name,
// 描述截短，只作面板 tooltip 用。
          description: description.length > 160 ? `${description.slice(0, 160)}…` : description,
        })
      }
      list.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
      return { error: null, tools: list }
    } catch (error) {
      return { error: String((error && error.message) || error), tools: [] }
    }
  }

/** @returns {Promise<object>} 界面渲染用的完整状态。 */
  const buildState = async () => {
    const standardTemplate = await modes.ensureTemplate(DEFAULT_MODE)
    const modeRows = await modes.describeModes()
// 模式下拉要同时列部署预设与角色自己的预设副本，否则显示的是模板、挂载的是副本。
    const rolePresetIds = new Set(modeRows.map((mode) => mode.id))
    const rolePresetRows = h.store.roles
      .filter((role) => role !== null && typeof role === 'object' && role.invalid !== true)
      .filter((role) => typeof role.id === 'string' && role.id !== '' && !rolePresetIds.has(role.id))
      .map((role) => ({
        id: role.id,
        label: `${role.name || role.id}（角色预设）`,
        description: `这个角色自己注册的预设：能力行按角色的模板 ${normalizeMode(role.mode)} 复制，改角色配置时重建。`,
        available: h.registered.has(role.id) || h.planned.has(role.id),
        source: 'role',
        file: null,
        rowCount: h.planned.get(role.id)?.plugins?.length ?? 0,
      }))
    const deploymentSnapshot = await modes.ensureDeployment()
    const mcp = await readMcpServers(h.options.home)
    const skillScan = await scanSkills({ home: h.options.home })
    const skillDirs = resolveRoleSkillDirs(h.store.roles, skillScan)

/** 角色预设健康状况：最近一次挂载后读到的诊断。
 * 不每次读状态都 presets.list()——那会审计每个预设并 await 整个 Host Loader；
 * 挂载失败只标 record.broken 不抛错，所以这份缓存是面板能看到「组合坏了」的唯一来源。 */
    const registry = [...h.registered.keys()].map((id) => {
      const broken = h.health.get(id)
      return broken === undefined ? { id } : { id, broken }
    })
    const registryError = h.healthError

    return {
      dir: h.store.dir,
      file: h.store.file,
      presetPrefix: h.options.prefix,
// 角色颜色：取角色自己的 color，缺失时按 id 散列兜底；权威定义在 lib/roleColor.js。
      leadColor: LEAD_COLOR,
      rolePalette: ROLE_PALETTE,
      platform: process.platform,
      bindMembers: bindingEnabled(h.options, h.store.settings),
      bindMembersSource: h.options.bindMembers
        ? 'config'
        : h.store.settings.bindMembers
          ? 'store'
          : 'off',
// 团队运行时是否开着：从 profile 组合里读，不是本插件存储的开关；bindMembers 单独上报。
      team: await team.readTeam(),
// 行的来源信息：字段名必须与 live-template 的 source 一致，改名会让界面静默拿到 null。
      template: {
        presetId: standardTemplate.source?.presetId ?? DEFAULT_MODE,
        file: standardTemplate.source?.file ?? null,
        extractedAt: standardTemplate.source?.extractedAt ?? null,
        rowCount: standardTemplate.plugins.length,
      },
// 下拉候选 = 部署预设 + 每个角色的自有预设副本（source: 'role'）。
      modes: [...modeRows, ...rolePresetRows],
// 说明书是数据：notes.json 与 roles.json 同目录，每次 /state 重读，改文件点刷新即生效。
// 缺键回落到 lib/notes.js 的默认值；error 只表示文件坏了。
      notes: await loadNotes(h.options.dir),
      notesFile: notesPath(h.options.dir),
// 部署的 MCP 服务器，实时读连接器存储；只读，本插件不写该文件。
      mcp: {
        file: mcp.file,
        error: mcp.error,
        services: mcp.servers,
      },
// 部署技能根下的技能列表，实时读；只读上下文，插件不写技能文件。
      skills: {
        roots: skillScan.roots,
        available: skillScan.skills,
        error: skillScan.error,
        row: {
          filesystem: SKILL_ROW_ID,
          tool: SKILL_TOOL_ROW_ID,
          plugin: SKILL_PLUGIN_NAME,
          toolPlugin: SKILL_TOOL_PLUGIN_NAME,
        },
      },
// 角色可选的模型：部署 llm 目录里的 provider 与模型，只读。
      models: await readModelCatalog(),
// 角色可隐藏的插件工具。列表故意是平的：tools.schemas() 不报归属，
// 猜出来的分组比不分组更糟，靠搜索框解决长列表。
      toolGate: readToolGate(),
// 角色已不能自带 loop 行，这里只作只读上下文：部署级 agent-loop 声明位置与全局并行度。
      workdir: {
        source: deploymentSnapshot.source,
        standard: deploymentSnapshot.loop,
      },
// registered：本插件登记的角色（含待挂载）；mounted：真挂进注册表的；
// deferred：改完即存、下次用到该角色时才挂载的。
      registered: [...new Set([...h.registered.keys(), ...h.planned.keys()])],
      mounted: [...h.registered.keys()],
      deferred: lifecycle.deferredIds(),
      registry,
      registryError,
      roles: h.store.roles.map((role) => {
// 角色显示的行来自它自己的 mode；在此解析，避免表格与刚注册的组合对不上。
      const mode = normalizeMode(role.mode)
      const entry = modeRows.find((candidate) => candidate.id === mode)
      const roleTemplate = modes.resolveSnapshot(mode) ?? standardTemplate

        return {
          ...role,
          presetId: role.id,
// 角色颜色；缺失时按 id 散列，界面总能拿到一个颜色。memberName 供界面把成员对回角色。
          color: normalizeColor(role.color) || colorForRoleId(role.id),
          memberName: memberNameForRole(role, h.options.prefix),
          mode,
          modeLabel: entry?.label ?? modeLabel(mode),
          modeAvailable: entry === undefined ? modes.resolveSnapshot(mode) !== null : entry.available !== false,
// 三个字段全空表示跟随模板，界面据此显示「跟随模板」。
          model: normalizeModel(role.model),
// 角色文件目录：界面只显示这一个路径。
          dir: h.store.roleDirOf(role.id),          roleFile: h.store.roleFileOf(role.id),
          agentsMdFile: h.store.agentsMdOf(role.id),
// 这个目录就是接线：buildDefinition 给指令行设 dshHome 指向这里，<roleDir>/AGENTS.md 因此生效。
// hasRow=false 表示该 mode 没有指令行（极简模式），此时没有 AGENTS.md 可加载。
          agentsMd: {
            ...(role.agentsMd ?? {}),
            dshHome: h.store.roleDirOf(role.id),
            linked: role.invalid !== true,
            hasRow: roleTemplate.plugins.some((row) => row?.id === INSTRUCTION_ROW_ID),
          },
          rows:
            role.invalid === true
              ? []
              : describeRows(roleTemplate.plugins, process.platform, role.overrides ?? {}),
// 角色的技能决定与解析结果：dirs 是组合后 skill-filesystem 行实际指向的目录（inherit 时为空），
// missing 是已选但磁盘上已不存在的技能名。
          skills: {
            ...normalizeSkills(role.skills),
            dirs: skillDirs.get(role.id)?.dirs ?? [],
            missing: skillDirs.get(role.id)?.missing ?? [],
// 极简模式两条技能行都没有：选技能的角色补一对，其它模式只重写已有行。
            hasFilesystemRow: roleTemplate.plugins.some((row) => row?.id === SKILL_ROW_ID),
            hasToolRow: roleTemplate.plugins.some((row) => row?.id === SKILL_TOOL_ROW_ID),
          },
        }
      }),
      loaded: h.store.loaded,
      error: h.store.loadError,
    }
  }

/** buildState() 并记住最近一次成功的正文：命令先写后渲染，渲染失败仍能给面板东西看。 */
  const refreshState = async () => {
    const next = await buildState()
    h.lastGoodState = next
    return next
  }

/** 写已落盘后命令的回包状态。
 * @returns {Promise<object>} */
  const replyState = () =>
    stateAfterWrite(refreshState, {
      fallback: h.lastGoodState,
      warn: (message) => h.logger.warn(message),
    })

/** 每次 /command 自增，保证写不会被缓存命中。 */
  const touchState = () => {
    h.stateRevision += 1
  }

/** buildState() 所读内容的指纹：自增修订号（覆盖本插件的所有写）
 * 加两个可手改文件的 size/mtime。
 * @returns {Promise<string>} */
  const stateStamp = async () => {
    const parts = [`r${h.stateRevision}`, h.store.loaded ? '1' : '0', String(h.store.loadError ?? '')]
    for (const file of [h.store.file, notesPath(h.options.dir)]) {
      try {
        const info = await stat(file)
        parts.push(`${info.size}:${info.mtimeMs}`)
      } catch {
        parts.push('missing')
      }
    }
    return parts.join('|')
  }

/** 面板每次打开或刷新都重建 /state，要读六个来源并序列化约 60 KB；
 * 只有本插件写或磁盘文件变才可能不同，所以缓存正文并记下它的精确指纹。 */
  const buildStateCached = async () => {
    const stamp = await stateStamp()
    if (h.stateCache !== null && h.stateCache.stamp === stamp) return h.stateCache
    const body = JSON.stringify(await refreshState())
    const etag = `W/"${createHash('sha1').update(body).digest('hex')}"`
    h.stateCache = { stamp, etag, body }
    return h.stateCache
  }

  return { readToolGate, buildState, refreshState, replyState, touchState, buildStateCached }
}
