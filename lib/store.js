/**
 * 角色的持久化入口。
 *
 * 角色不是 preset 的副本，而是用户意图的记录：名字、顺序、模式、逐行覆盖。其余内容每次
 * 加载都按那个模式的实时声明重组，所以 dsh 升级 preset 之后角色仍然可读。
 * 一个角色拥有自己的目录，本文件只负责装配 RoleStore 与数据目录位置。
 *
 * @module dsh-agent-team-roles/store
 */
import path from 'node:path'

import { defaultCapabilities, dshHome } from './deployment.js'
import { RoleStore } from './roleStore.js'
import { defaultSettings } from './storeDocument.js'
import { ID_PATTERN, RESERVED_IDS, normalizeRole } from './storeRole.js'

/** @returns {string} 插件在 dsh home 下的目录。 */
function defaultDir() {
  return path.join(dshHome(), 'agent-team-roles')
}

export { ID_PATTERN, RESERVED_IDS, RoleStore, defaultCapabilities, defaultDir, defaultSettings, dshHome, normalizeRole }
