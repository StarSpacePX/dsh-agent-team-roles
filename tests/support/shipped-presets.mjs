/** dsh 自带的四份 preset，作为测试夹具：插件不再留副本，运行时模式直接从部署的 Loader 条目读；
 * 测试没有部署，所以四份声明冻结在 tests/fixtures/presets/*.plugins.json，由这里交给假 Loader。 */
import { readFileSync } from 'node:fs'
import { MODES } from '../../lib/template.js'

/** The four ids, in the order the deployment lists them. */
export const SHIPPED_MODE_IDS = MODES.map((mode) => mode.id)

const CACHE = new Map()

/** 一份 shipped 声明，包成 Loader 的 options.config 形状（{ id, name, order, plugins }），懒读并缓存。 */
export const shippedPreset = (id) => {
  if (!CACHE.has(id)) {
    const url = new URL(`../fixtures/presets/${id}.plugins.json`, import.meta.url)
    const snapshot = JSON.parse(readFileSync(url, 'utf8'))
    CACHE.set(id, {
      id: snapshot.source.presetId,
      name: null, // a shipped preset carries no display name, only an id and an order
      order: snapshot.source.order,
      plugins: snapshot.plugins,
    })
  }
  return CACHE.get(id)
}
