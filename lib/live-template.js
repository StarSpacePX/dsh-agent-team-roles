/**
 * 直接从加载器读的实时 preset 声明。
 *
 * 角色是按「模式」组合的，而模式是这个部署里某个 agent preset 的插件列表，属于部署不属于
 * 本插件：四个自带模式与用户自建的 preset 一视同仁，都从 dsh 读它的那个地方读。
 *
 * @module dsh-agent-team-roles/live-template
 */

const JS_MARKER = '__jsExpr'

/** 把加载器解析出来的值改写成快照文件用的形状：只有 `{ __jsExpr }` 特殊，
 * 其余结构化拷贝，调用方改不到加载器自己的配置。
 * @param {unknown} value @returns {unknown} */
const toTemplateValue = (value) => {
  if (Array.isArray(value)) return value.map(toTemplateValue)
  if (value === null || typeof value !== 'object') return value
  if (typeof value[JS_MARKER] === 'string') return { __js__: value[JS_MARKER] }
  const out = {}
  for (const [key, item] of Object.entries(value)) out[key] = toTemplateValue(item)
  return out
}

/** 加载器当前持有的全部 preset 声明，按 preset id 索引。
 * 声明按形状识别（config.id 是非空字符串且 config.plugins 是数组）。
 * 调用方会与注册表名册取交集，所以单靠形状不会把无关行漏进模式清单。
 * @returns {Map<string, object>} */
export const presetDeclarations = (loader) => {
  const out = new Map()
  const entries = typeof loader?.entries === 'function' ? loader.entries() : []
  for (const entry of entries) {
    const options = entry?.options
    if (options === null || typeof options !== 'object') continue
    const config = options.config
    if (config === null || typeof config !== 'object') continue
    if (typeof config.id !== 'string' || config.id.trim() === '') continue
    if (!Array.isArray(config.plugins)) continue
    const id = config.id.trim()
    if (out.has(id)) continue // first declaration wins — a duplicate id is the registry's call to make
    out.set(id, {
      id,
      entryId: typeof entry.id === 'string' ? entry.id : null,
      plugin: typeof options.name === 'string' ? options.name : null,
      name: typeof config.name === 'string' && config.name !== '' ? config.name : null,
      order: typeof config.order === 'number' && Number.isFinite(config.order) ? config.order : null,
      plugins: config.plugins,
    })
  }
  return out
}

/** 把一个实时声明包成可用模板：source.live 标记它来自运行中的加载器，
 * source.file 恒为 null——已经没有文件了，界面不该印出不存在的路径。
 * @param {object} declaration @returns {object} */
export const templateFromDeclaration = (declaration) => ({
  $comment: 'Read live from the Loader’s parsed preset declaration (§5.40).',
  source: {
    file: null,
    live: true,
    declarationId: declaration.entryId,
    plugin: declaration.plugin,
    presetId: declaration.id,
    order: declaration.order,
    extractedAt: null,
  },
  plugins: toTemplateValue(declaration.plugins),
})
