/**
 * Role persistence.
 *
 * A role is *not* a copy of a preset: it is the user's intent recorded next to
 * the deployment's own preset — a name, an order, a mode, and per-row overrides.
 * Everything else is recomposed from that mode's live declaration on every load
 * (§5.62), which is what keeps a role readable after dsh upgrades its presets.
 *
 * Since §5.29 a role owns a directory:
 *
 *     <dir>/roles.json            the plugin's own index (version + settings)
 *     <dir>/<roleId>/role.json    the role's own configuration
 *     <dir>/<roleId>/AGENTS.md    the role's own instruction file
 *
 * The index file holds no roles at all. That is the point: "每一次新建
 * 角色都默认复制一份" is only meaningful if the copy is a *file*, so that the
 * user's edits land somewhere that belongs to that role alone.
 *
 * 这个文件只是**门面**：实现分在
 * `storeDocument.js`（文档层与原子写）、`storeRole.js`（角色规范化）、
 * `roleStore.js`（`RoleStore` 类）。
 *
 * @module dsh-agent-team-roles/store
 */
import path from 'node:path'

import { defaultCapabilities, dshHome } from './deployment.js'
import { RoleStore } from './roleStore.js'
import { defaultSettings } from './storeDocument.js'
import { ID_PATTERN, RESERVED_IDS, normalizeRole } from './storeRole.js'

/** @returns {string} the plugin's own directory under the dsh home. */
function defaultDir() {
  return path.join(dshHome(), 'agent-team-roles')
}

export { ID_PATTERN, RESERVED_IDS, RoleStore, defaultCapabilities, defaultDir, defaultSettings, dshHome, normalizeRole }
