/**
 * dsh-agent-team-roles — host half / v1 迁移角色的补目录（§5.29）。
 *
 * `RoleStore` 的迁移只搬得动数据：它不知道主会话的 `AGENTS.md` 在哪，因为那是
 * **插件级**的事实。放在这里就让两步各管一段 —— store 写文件，宿主半知道宿主长什么样。
 * 否则迁移过来的角色会是唯一一个没有自己 `AGENTS.md` 的角色，而那正是这次重写要
 * 消掉的不对称。
 *
 * @module dsh-agent-team-roles/host/adopt
 */
import { createAgentsMd, pickAgentsMdSource } from '../roleFiles.js'

/**
 * Give a role that arrived from the v1 single-file layout the same directory a
 * brand-new role gets (§5.29).
 *
 * The migration in `RoleStore` can only move data: it does not know where the
 * main session's `AGENTS.md` is, because that is a plugin-level fact. Doing it
 * here keeps the two steps apart — the store writes files, the host half knows
 * about the harness. A migrated role would otherwise be the one role with no
 * rules file of its own, which is exactly the asymmetry the rewrite removes.
 *
 * @param {import('../store.js').RoleStore} store
 * @param {{ home?: string }} options
 * @returns {Promise<string[]>} the ids that were adopted.
 */
export async function adoptMigratedRoles(store, options) {
  /** @type {string[]} */
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
