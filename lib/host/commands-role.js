/**
 * /command 的角色类动作：建、改、改名、换模式、挑技能、删、还原、开关一行、开关 MCP 服务。
 * 共同形状是「先落盘、再 commit」，回包始终是 replyState()——写配置不等重建。
 *
 * @module dsh-agent-team-roles/host/commands-role
 */
import { DEFAULT_MODE } from '../template.js'
import { createRole, slugify } from '../roles.js'
import { normalizeRole } from '../store.js'
import { normalizeModel } from '../storeRole.js'
import { defaultCapabilities, normalizeCapabilities, readMcpServers } from '../deployment.js'
import { assertRoleId, createAgentsMd, pickAgentsMdSource } from '../roleFiles.js'
import { SKILL_MODES, defaultSkills, normalizeSkills, scanSkills } from '../skills.js'
import { SERVER_NAME_PATTERN, requireMode, requireStringId } from './config.js'

/** @param {object} c `{ h, modes, lifecycle, patches, state }`
 * @returns {Record<string, (service: object, body: object, action: string) => Promise<object>>} */
export function roleHandlers(c) {
  const { h, modes, lifecycle, patches, state } = c

  return {
    'create-role': async (service, body, action) => {
      const rawName = String(body.name ?? '').trim()
// 这个 id 下面会当目录名用，不可用的必须在写任何东西之前拒绝，否则留下半个角色目录。
      const id = assertRoleId((requireStringId(body.id, 'id') ?? '').trim() || slugify(rawName, h.options.prefix))
      if (h.store.find(id) !== undefined) throw new Error(`角色已存在：${id}`)

// 新角色默认标准模式，除非调用方点名；可选的集合是实时名册，用户刚建的 preset 也能选。
      const mode = requireMode(body.mode, await modes.knownModeIds())
      const role = normalizeRole(createRole(id, rawName, await modes.ensureTemplate(mode), mode))
      if (body.description !== undefined) role.description = String(body.description)
      if (body.order !== undefined) role.order = Number(body.order)

// 新角色是一个目录而不是一行：先建文件，再写指向它的配置。接线就是目录本身，
// buildDefinition 会把指令行的 dshHome 指过去，用户从不需要手输路径。
      const source = await pickAgentsMdSource({ home: h.options.home })
      const copied = await createAgentsMd({ dir: h.store.dir, id, source })
      role.agentsMd = { source: copied.source, copiedAt: new Date().toISOString() }

      await h.store.upsert(normalizeRole(role))
// 写路径只落盘并标记待挂载，不拆掉重挂所有角色。
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
// 详情面板「角色 ID（成员名）」：newId 是完整预设 id（前缀由客户端补好），
// 改名要连目录和注册名一起换，见 store.rename。
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

// 角色跑在哪个模型上。三个字段都空 = 跟随模板；只给 provider/model 就算指定。
    'set-model': async (service, body, action) => {
      const id = String(body.id ?? '')
      const role = h.store.find(id)
      if (role === undefined) throw new Error(`角色不存在：${id}`)
      const model = normalizeModel({
        provider: body.provider,
        model: body.model,
        reasoningEffort: body.reasoningEffort,
      })
      const specified = model.provider.length > 0 && model.model.length > 0
      if (!specified && (model.provider.length > 0 || model.model.length > 0)) {
        throw new Error('provider 和 model 要么都给，要么都留空（留空 = 跟随模板）')
      }
      await h.store.upsert({ ...role, model })
      const result = await lifecycle.commit(service)
      return { action, id, model, result, state: await state.replyState() }
    },

// 换模式不是切一行：整个行表按新模式重新组合。覆盖按行 id 存、原样保留，
// 行在新模式里存在的继续生效，其余暂时失效直到用户切回来。
    'set-mode': async (service, body, action) => {      const id = String(body.id ?? '')
      const role = h.store.find(id)
      if (role === undefined) throw new Error(`角色不存在：${id}`)
      const mode = requireMode(body.mode, await modes.knownModeIds())
      await modes.ensureTemplate(mode)
      await h.store.upsert({ ...role, mode })
      const result = await lifecycle.commit(service)
      return { action, id, mode, result, state: await state.replyState() }
    },

// 角色用哪些技能。inherit（默认）不动模式的 skill-filesystem 行；pick 重写那一行
// （includeDefaultRoots: false + customSkillDirs），于是角色的清单就是它唯一发现的东西。
// 只接受部署真实持有的技能名。
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

// 还原到「这个角色刚建好」的样子，但保留用户认为属于身份的两样：名字/描述与自己的 AGENTS.md。
// 文件故意不动，所以「还原」不会吃掉手写内容；要重抄请用 reset-item agents-md。
      await h.store.upsert({ ...role, mode: DEFAULT_MODE, overrides: {}, capabilities: defaultCapabilities(), skills: defaultSkills() })
      const result = await lifecycle.commit(service)
      return { action, id, result, state: await state.replyState() }
    },

// 一次还原一个维度。rows 是纯配置；agents-md 会动文件，因为文件就是这个维度。
// 没有 loop 项：角色没有 loop 行可还原。
    'reset-item': async (service, body, action) => {
      const id = String(body.id ?? '')
      const item = String(body.item ?? '')
      const role = h.store.find(id)
      if (role === undefined) throw new Error(`角色不存在：${id}`)

      if (item === 'agents-md') {
        const source = await pickAgentsMdSource({ home: h.options.home })
        const copied = await createAgentsMd({ dir: h.store.dir, id, source })
        const overrides = { ...(role.overrides ?? {}) }
// 行的覆盖属于「这个角色读哪些文件」，留着旧候选列表就只算半个还原。
        delete overrides['agent-instructions']
        await h.store.upsert({
          ...role,
          overrides,
          agentsMd: { source: copied.source, copiedAt: new Date().toISOString() },
        })
      } else if (item === 'rows') {
// 「还原默认」覆盖所有行级能力：预设行覆盖、MCP 门与插件工具门。
        const capabilities = normalizeCapabilities(role.capabilities)
        capabilities.mcp.deny = []
        capabilities.toolGate.deny = []
        await h.store.upsert({ ...role, overrides: {}, capabilities })
      } else if (item === 'skills') {
// 回到「继承模式根目录下的全部技能」，也就是新建角色的状态；已选名字留在文件里，
// 所以这个按钮是切换模式，不是丢掉一长串选择。
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

// 只接受部署真正声明的服务器：门会与实时注册表对账，没人注册的名字会让之后每次挂载
// 都静默失效，不如在面板还开着的时候就拒绝这个拼写错误。
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
