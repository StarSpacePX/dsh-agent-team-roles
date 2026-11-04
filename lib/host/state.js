/**
 * dsh-agent-team-roles — host half / 状态投影与 `/state` 正文缓存（§5.58 A4/D2）。
 *
 * `buildState()` 是面板唯一的读入口：它把存储、模式名册、部署快照、MCP 连接器、
 * 技能目录、说明书（notes.json）、团队开关和角色注册诊断拼成一份 JSON。
 *
 * 这里同时放着它的两个包裹：`replyState()`（写已经落盘、渲染失败时的降级回包）
 * 与 `buildStateCached()`（同一份正文只构造一次，重复 GET 直接 304）。两者都是
 * §5.58 的产物，且都只依赖这一份状态，所以跟投影放在一起。
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

/**
 * @param {object} h - the shared host state ({@link ./context.js}).
 * @param {object} deps - `{ modes, team, lifecycle }`.
 * @returns {object} the state projection API.
 */
export function createState(h, deps) {
  const { modes, team, lifecycle } = deps

  /**
   * §5.55 — the global tools the 「插件」 panel offers.
   *
   * Read from the root scope's registry (see the `rootTools` injection), minus two
   * things that are not this panel's business: the MCP tools — their servers are
   * what the MCP panel switches, and their names are resolved by prefix there —
   * and `run_code`, which the registry refuses to restrict.
   *
   * A missing `tools` service is reported rather than hidden: the panel then
   * says why it is empty instead of looking like a deployment with no tools.
   * Read live on every `/state` — a plugin that just registered a tool should
   * appear without a restart, and the list costs no IO (it is already in
   * memory).
   *
   * @returns {{ error: string | null, tools: { name: string, description: string }[] }}
   */
  const readToolGate = () => {
    const tools = h.rootTools
    if (tools === null || tools === undefined || typeof tools.schemas !== 'function') {
      return { error: 'tools 服务不可用，读不到工具清单', tools: [] }
    }
    try {
      /** @type {{ name: string, description: string }[]} */
      const list = []
      for (const schema of tools.schemas()) {
        const name = schema === null || schema === undefined ? '' : String(schema.name ?? '')
        if (name.length === 0 || name === RUN_CODE_NAME) continue
        if (name.startsWith(MCP_TOOL_PREFIX)) continue
        const description = schema === null || schema === undefined ? '' : String(schema.description ?? '')
        list.push({
          name,
          // Only a hint for the panel's tooltip: the full description of a
          // harness tool runs to paragraphs, and this list is one row per tool.
          description: description.length > 160 ? `${description.slice(0, 160)}…` : description,
        })
      }
      list.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
      return { error: null, tools: list }
    } catch (error) {
      return { error: String((error && error.message) || error), tools: [] }
    }
  }

  /** @returns {Promise<object>} the full state the UI renders from. */
  const buildState = async () => {
    const standardTemplate = await modes.ensureTemplate(DEFAULT_MODE)
    const modeRows = await modes.describeModes()
    // 用户 m07126/m07129：**角色复制出来的那份预设也要出现在模式下拉里，并且默认选中它**。
    // 只列部署预设的时候，下拉显示的是模板，角色实际挂的是 `role.id` 那份复制品——显示
    // 与实际不是同一个东西。副本 `dsh-arbiter-roles` 同源同改。
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

    /**
     * §5.54 — 角色预设的健康状况，来自**最近一次挂载之后**读到的诊断。
     *
     * 不再每次读状态都 `presets.list()`：那会对每个预设做一次审计，并在有 pending
     * 行时 `await` 整个 Host Loader（`…\dsh-agent-preset-registry\lib\index.js:557-568`）。
     * `register()` 对挂载失败只标记 `record.broken`、不抛，所以这份缓存是面板能看见
     * 「这个角色的组合坏了」的唯一来源 —— 由 `refreshHealth()` 在挂载后刷新。
     *
     * @type {{ id: string, broken?: string }[]}
     */
    const registry = [...h.registered.keys()].map((id) => {
      const broken = h.health.get(id)
      return broken === undefined ? { id } : { id, broken }
    })
    const registryError = h.healthError

    return {
      dir: h.store.dir,
      file: h.store.file,
      presetPrefix: h.options.prefix,
      // §5.59 — 群聊 tab 的颜色来源：每个角色自己的 `color`，加一份调色板与 Lead 色
      // （只在「成员不属于任何角色」时用来散列兜底）。权威定义在 `lib/roleColor.js`。
      leadColor: LEAD_COLOR,
      rolePalette: ROLE_PALETTE,
      platform: process.platform,
      bindMembers: bindingEnabled(h.options, h.store.settings),
      bindMembersSource: h.options.bindMembers
        ? 'config'
        : h.store.settings.bindMembers
          ? 'store'
          : 'off',
      // §5.33 — 团队运行时本身是否开着。这不是本插件存储里的一个开关：团队是 dsh
      // 自带的一个组合包，只有 profile 的组合知道它选没选。`bindMembers` 仍然单独
      // 上报，因为它是本插件的行为，而团队开不开是部署的行为 —— 面板把两者放在同一
      // 行上说明，但不把它们混成一个值。
      team: await team.readTeam(),
      // R6 — whether the client should mount the 「群聊」 tab at all. Read from
      // the settings document (not the plugin config) so the toggle takes effect
      // without a dsh restart (§5.26).
      hideChatTab: h.store.settings.hideChatTab === true,
      // Provenance of the rows the UI shows. The mode's `source` block comes
      // from `lib/live-template.js` and carries `file` / `declarationId` /
      // `plugin` / `presetId` / `order` / `extractedAt` — those exact names, so a
      // rename here would silently ship `null`s to the UI and make the rows look
      // unattributed. `file` and `extractedAt` are null since §5.62: the
      // composition is read live and there is no file. This is the `standard`
      // one; every available mode, each with its own row count, is in `modes`.
      template: {
        presetId: standardTemplate.source?.presetId ?? DEFAULT_MODE,
        file: standardTemplate.source?.file ?? null,
        extractedAt: standardTemplate.source?.extractedAt ?? null,
        rowCount: standardTemplate.plugins.length,
      },
      // §5.40 — 下拉候选 = 部署预设 + **本插件每个角色的自有预设**（用户 m07129）。
      // 前半段每项来自 Loader 声明；后半段是运行时注册出来的复制品，`source: 'role'`。
      // 角色的「当前值」在下面的 `roles[].presetId`（= 它自己的注册项）。
      modes: [...modeRows, ...rolePresetRows],
      // §5.34 — 说明书现在是数据（m08033）。`notes.json` 与 roles.json 同目录，
      // 每次 /state 都重读一遍，所以「改 json → 点刷新」就能换掉面板上的说明文字，
      // 不需要重启，也不需要碰 client.js。缺失的键回落到 lib/notes.js 里的默认值，
      // 因此老文件不会把新加的说明变空。error 只可能是「文件坏了」，如实上报。
      notes: await loadNotes(h.options.dir),
      notesFile: notesPath(h.options.dir),
      // The deployment's MCP servers, read live from the connector's storage so
      // a server the user adds there shows up here without regenerating
      // anything (§5.25). Read-only: the plugin never writes that file.
      mcp: {
        file: mcp.file,
        error: mcp.error,
        services: mcp.servers,
      },
      // §5.47 — the skills the deployment's own roots hold, so the panel offers
      // a real list instead of a text field. Read live on every `/state`: a
      // skill dropped into `~/.dsh/skills` shows up on the next refresh, and the
      // list is the same set the loader's provider would discover. The plugin
      // never writes a skill file; this is read-only context.
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
      // §5.55 — the plugin tools a role may hide from itself (user m18131:
      // 「角色可见性禁用就行，你加一下，在 MCP 和技能中间」). The panel is a flat
      // list on purpose: `tools.schemas()` reports no owner, so grouping the
      // tools by the plugin that registered them is not something the
      // deployment can be asked — and a guessed grouping would be worse than
      // none. The filter box is what makes a long list workable.
      toolGate: readToolGate(),
      // §5.30 — a role can no longer carry a loop row of its own (see the
      // module header of `deployment.js` for the two walls that make it
      // impossible), so there is nothing per-role to switch here. What is left
      // is read-only context for the panel: where the *deployment's* own
      // `agent-loop` declaration sits, and the global parallelism it declares.
      // Each role's working directory is on the role itself, below.
      workdir: {
        source: deploymentSnapshot.source,
        standard: deploymentSnapshot.loop,
      },
      // §5.54 — `registered` 现在是「本插件登记了哪些角色」（挂载的 + 待挂载的），
      // 因为一个改过配置、还没被用到的角色并不是错误状态；`mounted` 才是真的挂在
      // 注册表里的那些，`deferred` 是「改完即存、下次用到该角色时挂载」的那些。
      registered: [...new Set([...h.registered.keys(), ...h.planned.keys()])],
      mounted: [...h.registered.keys()],
      deferred: lifecycle.deferredIds(),
      registry,
      registryError,
      roles: h.store.roles.map((role) => {
      // §5.40 — the rows a role shows are the rows of *its* mode. Resolved here
      // rather than sent to the client, so the table can never disagree with the
      // composition that was just registered; a mode that is not in the
      // deployment falls back to the standard rows.
      const mode = normalizeMode(role.mode)
      const entry = modeRows.find((candidate) => candidate.id === mode)
      const roleTemplate = modes.resolveSnapshot(mode) ?? standardTemplate

        return {
          ...role,
          presetId: role.id,
          // §5.59 — 角色颜色。`color` 缺失（老角色还没被 `RoleStore` 补过）时按 id 散列，
          // 界面永远拿得到一个颜色；`memberName` 让群聊能把消息里的成员名对回角色。
          color: normalizeColor(role.color) || colorForRoleId(role.id),
          memberName: memberNameForRole(role, h.options.prefix),
          mode,
          modeLabel: entry?.label ?? modeLabel(mode),
          modeAvailable: entry === undefined ? modes.resolveSnapshot(mode) !== null : entry.available !== false,
          // Where this role's files live (§5.29). The UI shows this directory —
          // one path, not three — and nothing points a role at a hand-typed path.
          dir: h.store.roleDirOf(role.id),
          roleFile: h.store.roleFileOf(role.id),
          agentsMdFile: h.store.agentsMdOf(role.id),
          // §5.30 — this directory *is* the wiring: `buildDefinition` gives the
          // role's `agent-instructions` row a `dshHome` pointing here, so
          // `<roleDir>/AGENTS.md` loads for that role in whatever directory its
          // task runs. Saying so explicitly keeps the UI from having to infer it
          // from an override that no longer has to exist.
          //
          // `hasRow` is the honest caveat (§5.32): 极简模式 ships no
          // `agent-instructions` row at all, so there the wiring has nothing to
          // attach to and the role's own file is simply not read. The UI says so
          // instead of showing a green line that would be false.
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
          // §5.47 — this role's skill decision, plus what it resolved to right
          // now. `dirs` is what the composed `skill-filesystem` row actually
          // points at (empty in `inherit` mode), and `missing` lists picked
          // names that are no longer on disk — the panel shows both rather than
          // letting a vanished skill look like it is still mounted.
          skills: {
            ...normalizeSkills(role.skills),
            dirs: skillDirs.get(role.id)?.dirs ?? [],
            missing: skillDirs.get(role.id)?.missing ?? [],
            // 极简模式 ships neither row (§5.47): a picking role there gains
            // the pair, every other mode only rewrites the row it already has.
            hasFilesystemRow: roleTemplate.plugins.some((row) => row?.id === SKILL_ROW_ID),
            hasToolRow: roleTemplate.plugins.some((row) => row?.id === SKILL_TOOL_ROW_ID),
          },
        }
      }),
      loaded: h.store.loaded,
      error: h.store.loadError,
    }
  }

  /**
   * `buildState()`, remembering the last one that worked.
   *
   * §5.58 A4 — every command writes first and renders its reply second. Keeping
   * the last good state means a reply whose render failed can still hand the
   * panel something to show.
   */
  const refreshState = async () => {
    const next = await buildState()
    h.lastGoodState = next
    return next
  }

  /**
   * The reply state for a command whose write has already landed (§5.58 A4).
   *
   * @returns {Promise<object>}
   */
  const replyState = () =>
    stateAfterWrite(refreshState, {
      fallback: h.lastGoodState,
      warn: (message) => h.logger.warn(message),
    })

  /** Bumped by every `/command`, so a write can never be served from the cache. */
  const touchState = () => {
    h.stateRevision += 1
  }

  /**
   * A cheap fingerprint of everything `buildState()` reads: our own revision
   * counter (covers every write we make, even within the same millisecond as the
   * read) plus the size and mtime of the two files a human can edit behind our
   * back.
   *
   * @returns {Promise<string>}
   */
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

  /**
   * §5.58 D2 — the panel rebuilds `/state` on every open and every refresh, and
   * `buildState()` reads six sources and re-serializes ~60 KB each time
   * (baseline: cold 113 ms, warm 119.8 ms, always exactly 61963 bytes). Nothing
   * in it can change except when **we** write or when a file on disk does, so
   * the last body is kept together with the exact fingerprint it was built from
   * and a repeat GET answers 304 instead of rebuilding.
   *
   * @returns {Promise<{ etag: string, body: string }>}
   */
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
