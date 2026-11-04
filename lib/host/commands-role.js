/**
 * dsh-agent-team-roles — host half / `/command` 的角色类动作（§5.29–§5.32、§5.39、§5.47）。
 *
 * 这一组动作都以「一个角色」为单位：建、改、改名、换模式、挑技能、删、还原、
 * 改一行开关、清一行开关、开关一个 MCP 服务。它们的共同形状是**先落盘、再 `commit`**，
 * 回包始终是 `replyState()`（§5.54：写配置不等重建）。
 *
 * @module dsh-agent-team-roles/host/commands-role
 */
import { DEFAULT_MODE } from '../template.js'
import { createRole, slugify } from '../roles.js'
import { normalizeRole } from '../store.js'
import { defaultCapabilities, normalizeCapabilities, readMcpServers } from '../deployment.js'
import { assertRoleId, createAgentsMd, pickAgentsMdSource } from '../roleFiles.js'
import { SKILL_MODES, defaultSkills, normalizeSkills, scanSkills } from '../skills.js'
import { SERVER_NAME_PATTERN, requireMode, requireStringId } from './config.js'

/**
 * @param {object} c - `{ h, modes, lifecycle, patches, state }`.
 * @returns {Record<string, (service: object, body: object, action: string) => Promise<object>>}
 */
export function roleHandlers(c) {
  const { h, modes, lifecycle, patches, state } = c

  return {
    'create-role': async (service, body, action) => {
      const rawName = String(body.name ?? '').trim()
      // §5.58 A1 — this id becomes a directory name below, so an unusable one
      // must be refused *before* anything is written. `roleDir` is the hard
      // guard on the path; this is the fail-fast guard, so a refusal never
      // leaves a half-created role directory behind.
      const id = assertRoleId((requireStringId(body.id, 'id') ?? '').trim() || slugify(rawName, h.options.prefix))
      if (h.store.find(id) !== undefined) throw new Error(`角色已存在：${id}`)

      // A new role starts on 标准模式 unless the caller names another one
      // (m07307: 「默认使用标准模式」). The set it may name is the live roster
      // (§5.40), so a preset the user just created is selectable too.
      const mode = requireMode(body.mode, await modes.knownModeIds())
      const role = normalizeRole(createRole(id, rawName, await modes.ensureTemplate(mode), mode))
      if (body.description !== undefined) role.description = String(body.description)
      if (body.order !== undefined) role.order = Number(body.order)

      // A new role is a *directory*, not a row (§5.29): create the files
      // first, then the configuration that points at them. The wiring is the
      // directory itself (§5.30) — `buildDefinition` hands the role's
      // `agent-instructions` row a `dshHome` of that directory, so nothing
      // here has to name a path and the user never types one.
      const source = await pickAgentsMdSource({ home: h.options.home })
      const copied = await createAgentsMd({ dir: h.store.dir, id, source })
      role.agentsMd = { source: copied.source, copiedAt: new Date().toISOString() }

      await h.store.upsert(normalizeRole(role))
      // §5.54 — 写路径只落盘 + 标「待挂载」，不再拆掉重挂所有角色。
      const result = await lifecycle.commit(service)
      return { action, id, agentsMd: copied, result, state: await state.replyState() }
    },

    'update-role': async (service, body, action) => {
      const id = String(body.id ?? '')
      const role = h.store.find(id)
      if (role === undefined) throw new Error(`角色不存在：${id}`)
      const merged = {
        ...role,
        name: body.name === undefined ? role.name : String(body.name),
        description: body.description === undefined ? role.description : String(body.description),
        order: body.order === undefined ? role.order : Number(body.order),
      }
      // 详情面板「角色 ID（成员名）」那一行：`newId` 是完整预设 id
      // （前缀由客户端补好），改名要连目录和注册名一起换，见 `store.rename`。
      const nextId = body.newId === undefined ? id : (requireStringId(body.newId, 'newId') ?? '').trim()
      const renamed = nextId !== id
      if (renamed) {
        if (nextId.length === 0) throw new Error('角色 id 不能为空')
        if (h.store.find(nextId) !== undefined) throw new Error(`角色已存在：${nextId}`)
        merged.id = nextId
        await h.store.rename(id, nextId)
      }
      const stored = await h.store.upsert(normalizeRole(merged))
      const result = await lifecycle.commit(service)
      return { action, id: stored.id, previousId: id, renamed, result, state: await state.replyState() }
    },

    // §5.32 — which of the deployment's four modes this role is built from.
    //
    // This is not a row switch: the role's entire row table is re-composed
    // from the new mode's snapshot. Overrides are keyed by row id and are left
    // exactly as they are, so a switch only re-reads them — the ones whose row
    // exists in the new mode keep applying, the rest sit inert until the user
    // switches back. Deleting them here would make 「试试另一个模式」 cost the
    // user every switch they had already made.
    'set-mode': async (service, body, action) => {
      const id = String(body.id ?? '')
      const role = h.store.find(id)
      if (role === undefined) throw new Error(`角色不存在：${id}`)
      const mode = requireMode(body.mode, await modes.knownModeIds())
      await modes.ensureTemplate(mode)
      await h.store.upsert({ ...role, mode })
      const result = await lifecycle.commit(service)
      return { action, id, mode, result, state: await state.replyState() }
    },

    // §5.47 — the skills this role uses.
    //
    // `inherit` (the default, and the behaviour before this section) leaves the
    // mode's `skill-filesystem` row alone. `pick` rewrites that existing row's
    // config (`includeDefaultRoots: false` + `customSkillDirs`), so the role's
    // own list is the *only* thing it discovers — 勾选就是选用，不勾选就是不加载.
    //
    // Only names the deployment actually holds are accepted: a typo becomes an
    // error here instead of a preset that mounts nothing and looks fine.
    //
    // `ids` is stored in both modes on purpose — flipping back to `inherit`
    // must not throw the user's selection away, and flipping forward again
    // restores exactly it.
    'set-skills': async (service, body, action) => {
      const id = String(body.id ?? '')
      const role = h.store.find(id)
      if (role === undefined) throw new Error(`角色不存在：${id}`)

      const mode = String(body.mode ?? '').trim()
      if (!SKILL_MODES.includes(mode)) {
        throw new Error(`技能模式必须是 inherit 或 pick，收到：${JSON.stringify(body.mode ?? null)}`)
      }

      const scan = await scanSkills({ home: h.options.home })
      const known = new Set(scan.skills.map((skill) => skill.name))
      /** @type {string[]} */
      const ids = []
      for (const value of Array.isArray(body.ids) ? body.ids : []) {
        const skillName = String(value ?? '').trim()
        if (skillName.length === 0) continue
        if (!known.has(skillName)) throw new Error(`这个部署里没有技能：${skillName}`)
        if (!ids.includes(skillName)) ids.push(skillName)
      }

      const skills = normalizeSkills({ mode, ids })
      await h.store.upsert({ ...role, skills })
      const result = await lifecycle.commit(service)
      return { action, id, skills, result, state: await state.replyState() }
    },

    'delete-role': async (service, body, action) => {
      const id = String(body.id ?? '')
      const removedRole = h.store.find(id)
      if (removedRole === undefined) throw new Error(`角色不存在：${id}`)
      await h.store.remove(id)
      const result = await lifecycle.commit(service)
      return { action, id, removed: removedRole, result, state: await state.replyState() }
    },

    'reset-role': async (service, body, action) => {
      const id = String(body.id ?? '')
      const role = h.store.find(id)
      if (role === undefined) throw new Error(`角色不存在：${id}`)

      // Layer 2 of §5.29's four layers: everything goes back to "as if this
      // role had just been created" — *except* the two things the user says
      // a role's identity is: its name/description, and its own AGENTS.md.
      // The file is deliberately left alone here so that "还原" can never eat
      // something the user wrote by hand; `reset-item` with `agents-md` is the
      // explicit way to re-copy it from the main session.
      //
      // §5.32 — `mode` is part of "everything": a role that had just been
      // created would be on 标准模式, which is what the user named as the
      // default. The button says so.
      await h.store.upsert({ ...role, mode: DEFAULT_MODE, overrides: {}, capabilities: defaultCapabilities(), skills: defaultSkills() })
      const result = await lifecycle.commit(service)
      return { action, id, result, state: await state.replyState() }
    },

    // Layer 3: one dimension at a time. `rows` is pure configuration;
    // `agents-md` is the one that touches a file, because the file *is* the
    // dimension. There is no `loop` item any more (§5.30) — a role has no loop
    // row to reset.
    'reset-item': async (service, body, action) => {
      const id = String(body.id ?? '')
      const item = String(body.item ?? '')
      const role = h.store.find(id)
      if (role === undefined) throw new Error(`角色不存在：${id}`)

      if (item === 'agents-md') {
        const source = await pickAgentsMdSource({ home: h.options.home })
        const copied = await createAgentsMd({ dir: h.store.dir, id, source })
        const overrides = { ...(role.overrides ?? {}) }
        // The row override is part of "which files does this role read"; a
        // reset would be half a reset if an old candidate list survived it.
        // (Since §5.30 the role is wired to its directory implicitly, so this
        // only ever removes what the user added on top of that.)
        delete overrides['agent-instructions']
        await h.store.upsert({
          ...role,
          overrides,
          agentsMd: { source: copied.source, copiedAt: new Date().toISOString() },
        })
      } else if (item === 'rows') {
        // 「还原默认」 covers every row-level capability: the preset row
        // overrides, the MCP gate and (since §5.55) the plugin tool gate.
        const capabilities = normalizeCapabilities(role.capabilities)
        capabilities.mcp.deny = []
        capabilities.toolGate.deny = []
        await h.store.upsert({ ...role, overrides: {}, capabilities })
      } else if (item === 'skills') {
        // §5.47 — back to "inherit whatever the mode's roots hold", the state a
        // freshly created role is in. The picked names stay in the file, so the
        // button is a mode switch rather than a way to lose a long selection.
        await h.store.upsert({ ...role, skills: { ...defaultSkills(), ids: normalizeSkills(role.skills).ids } })
      } else {
        throw new Error(`未知的还原项：${item || '(空)'}（可选 agents-md / rows / skills）`)
      }

      const result = await lifecycle.commit(service)
      return { action, id, item, result, state: await state.replyState() }
    },

    'set-override': async (service, body, action) => {
      const id = String(body.id ?? '')
      const rowId = String(body.row ?? '')
      if (rowId.length === 0) throw new Error('缺少行 id')
      const role = h.store.find(id)
      if (role === undefined) throw new Error(`角色不存在：${id}`)

      /** @type {Record<string, { disabled?: boolean, config?: object }>} */
      const overrides = patches.patchOverrides(role.overrides ?? {}, rowId, {
        disabled: body.disabled,
        config: body.config,
        clearConfig: body.clearConfig,
      })

      await h.store.upsert({ ...role, overrides })
      const result = await lifecycle.commit(service)
      return { action, id, row: rowId, result, state: await state.replyState() }
    },

    'clear-override': async (service, body, action) => {
      const id = String(body.id ?? '')
      const rowId = String(body.row ?? '')
      const role = h.store.find(id)
      if (role === undefined) throw new Error(`角色不存在：${id}`)
      const overrides = { ...(role.overrides ?? {}) }
      delete overrides[rowId]
      await h.store.upsert({ ...role, overrides })
      const result = await lifecycle.commit(service)
      return { action, id, row: rowId, result, state: await state.replyState() }
    },

    'set-mcp': async (service, body, action) => {
      const id = String(body.id ?? '')
      const role = h.store.find(id)
      if (role === undefined) throw new Error(`角色不存在：${id}`)
      if (typeof body.enabled !== 'boolean') throw new Error('set-mcp 需要 enabled 布尔值')

      const serverName = String(body.server ?? '').trim()
      if (!SERVER_NAME_PATTERN.test(serverName)) {
        throw new Error(`MCP server 名字不合法：${JSON.stringify(body.server ?? null)}`)
      }

      // Only servers the deployment actually declares are accepted. The gate
      // resolves its deny list against the live registry, so a name nothing
      // registers would make every later mount a silent no-op — better to
      // reject the typo while the panel is still open.
      const known = (await readMcpServers(h.options.home)).servers.map((server) => server.serverName)
      if (!known.includes(serverName)) {
        throw new Error(
          `部署里没有 MCP server「${serverName}」${known.length > 0 ? `，现有：${known.join('、')}` : '（连接器里还没有任何连接）'}`,
        )
      }

      const capabilities = patches.patchMcpDeny(role.capabilities, serverName, body.enabled)

      await h.store.upsert({ ...role, capabilities })
      const result = await lifecycle.commit(service)
      return { action, id, server: serverName, enabled: body.enabled, result, state: await state.replyState() }
    },
  }
}
