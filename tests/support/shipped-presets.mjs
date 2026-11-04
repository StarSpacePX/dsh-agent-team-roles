/**
 * The four shipped presets, as test fixtures (§5.62).
 *
 * The plugin keeps no copy of them any more: at runtime a mode is read straight
 * out of the deployment's Loader entry. A test has no deployment, so the four
 * declarations dsh ships live in `tests/fixtures/presets/*.plugins.json` and are
 * handed to the harness's fake Loader from here.
 *
 * The files being frozen at the day they were captured is fine — the tests
 * assert *what this plugin does with those rows*, not what today's dsh ships.
 *
 * @module dsh-agent-team-roles/tests/support/shipped-presets
 */
import { readFileSync } from 'node:fs'
import { MODES } from '../../lib/template.js'

/** The four ids, in the order the deployment lists them. */
export const SHIPPED_MODE_IDS = MODES.map((mode) => mode.id)

const CACHE = new Map()

/**
 * One shipped declaration in the Loader's `options.config` shape
 * (`{ id, name, order, plugins }`); lazily read and cached.
 *
 * @param {string} id
 * @returns {{ id: string, name: string | null, order: number | null, plugins: object[] }}
 */
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
