/**
 * v1 迁移角色的补目录。
 *
 * RoleStore 的迁移只搬数据，不知道主会话的 AGENTS.md 在哪——那是插件级的事实。这里给迁来的
 * 角色补上与新建角色相同的目录，否则它会是唯一一个没有自己 AGENTS.md 的角色。
 *
 * @module dsh-agent-team-roles/host/adopt
 */
import { createAgentsMd, pickAgentsMdSource } from '../roleFiles.js'

/** 给从 v1 单文件布局迁来的角色补上与新建角色相同的目录。 */
export async function adoptMigratedRoles(store, options) {
  const adopted = []

  for (const id of store.migrated) {
    const role = store.find(id)
    if (role === undefined) continue

    const source = await pickAgentsMdSource({ home: options.home })
    const copied = await createAgentsMd({ dir: store.dir, id, source })

    await store.upsert({
      ...role,
      agentsMd: { source: copied.source, copiedAt: new Date().toISOString() },
    })
    adopted.push(id)
  }

  return adopted
}
