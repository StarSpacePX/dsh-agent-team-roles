// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 容器第 2 段（原 1960-2119）：字段草稿、dirty 基线、displayRole。

import { nakedMemberName } from './../constants.js';
import { chatTab } from './../entries.js';
import { React } from './../react.js';

function useTeamRolesDrafts(core) {
  const { draft, idBaseline$, idDraft, idSyncPending$, markDirty, selected, setDraft, setPending, state } = core;
  const editDraft = (field, setter) => (event) => {
    setter(event.target.value);
    markDirty(field);
  };

  /**
   * §B1 — **只有「角色 ID」那个框不能改 `onChange`**：`tests/plugin/ui-and-log.test.mjs:841`
   * 有一条源码形状断言，要求那一行必须是
   * `onChange: (event) => setIdDraft(event.target.value)`，而那个文件不在本任务的
   * 写入范围内。所以这一笔改成"跟同步时记下的基线比"：`idDraft` 一旦偏离
   * `idBaseline$`，就说明是用户敲进去的。
   *
   * 依赖只放 `[idDraft]`：切换角色时先由上面的同步 effect 写好基线、下一帧
   * `idDraft` 才跟着变，那一帧靠 `idSyncPending$` 放行，不会误判成 dirty。
   */
  React.useEffect(() => {
    if (idSyncPending$.current) {
      idSyncPending$.current = false;
      return;
    }
    if (idBaseline$.current === null) return;
    const prefix =
      state && typeof state.presetPrefix === 'string' && state.presetPrefix.length > 0
        ? state.presetPrefix
        : 'team-';
    if (idDraft === nakedMemberName(idBaseline$.current, prefix)) return;
    markDirty('id');
  }, [idDraft]);

  // R6 — keep the conversation tab in step with the switch, live: hiding or
  // showing it goes through the slot disposer, so no reload is needed.
  const hideChatTab = state === null ? undefined : state.hideChatTab;
  React.useEffect(() => {
    if (hideChatTab === undefined) return;
    chatTab.setHidden(hideChatTab === true);
  }, [hideChatTab]);

  // §5.35 — the optimistic overlay for the switches that carry one.
  //
  // `writeDraft` merges a patch; a value of `undefined` **drops** the
  // overlay key again (the reply landed, so `/state` is the truth now).
  const markPending = React.useCallback((key, on) => {
    setPending((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  /**
   * @param {string} roleId
   * @param {object} patch
   * @param {{ keepOtherRole?: boolean }} [options] `keepOtherRole` is for the
   *   **reply** path: a `set-switches` answer that arrives after the user
   *   moved to another role must not resurrect (or wipe) that role's overlay.
   *   A user gesture still takes the draft over, because it is about the role
   *   they are looking at right now.
   */
  const writeDraft = React.useCallback((roleId, patch, options) => {
    const keepOtherRole = options !== undefined && options.keepOtherRole === true;
    setDraft((current) => {
      if (keepOtherRole && current !== null && current.roleId !== roleId) return current;
      const base =
        current !== null && current.roleId === roleId
          ? current
          : { roleId, rows: {}, mcp: {}, tools: {}, config: {}, skills: {} };
      const merged = {};
      for (const field of ['rows', 'mcp', 'tools', 'config', 'skills']) {
        const next = { ...base[field] };
        for (const [key, value] of Object.entries(patch[field] || {})) {
          if (value === undefined) delete next[key];
          else next[key] = value;
        }
        merged[field] = next;
      }
      return { roleId, ...merged };
    });
  }, []);

  // What the panels actually render: the selected role with this session's
  // not-yet-confirmed flips on top. Everything else comes from `/state`.
  const displayRole = React.useMemo(() => {
    if (selected === null || draft === null || draft.roleId !== selected.id) return selected;
    const rows = selected.rows.map((row) => {
      const hasDisabled = Object.prototype.hasOwnProperty.call(draft.rows, row.id);
      const hasConfig = Object.prototype.hasOwnProperty.call(draft.config, row.id);
      if (!hasDisabled && !hasConfig) return row;
      const next = { ...row };
      if (hasDisabled) {
        next.disabled = draft.rows[row.id];
        next.hasOverride =
          row.hasOverride === true || row.templateDisabled !== next.disabled;
      }
      if (hasConfig) {
        const config = { ...(row.config || {}) };
        for (const [key, value] of Object.entries(draft.config[row.id])) {
          if (value === null) delete config[key];
          else config[key] = value;
        }
        next.config = config;
        next.hasOverride = true;
      }
      return next;
    });
    const capabilities = { ...(selected.capabilities || {}) };
    if (Object.keys(draft.mcp).length > 0) {
      const mcp = capabilities.mcp || {};
      const deny = new Set(mcp.deny || []);
      for (const [server, enabled] of Object.entries(draft.mcp)) {
        if (enabled) deny.delete(server);
        else deny.add(server);
      }
      capabilities.mcp = { ...mcp, deny: [...deny] };
    }
    // §5.55 — 插件可见性名单的同款乐观覆盖：勾掉一个工具就立刻按目标名单画，
    // 不用等宿主半回包（回包后 overlay 被 drop，`/state` 才是真相）。
    const toolsDraft = draft.tools || {};
    if (Object.keys(toolsDraft).length > 0) {
      const toolGate = capabilities.toolGate || {};
      const deny = new Set(toolGate.deny || []);
      for (const [name, enabled] of Object.entries(toolsDraft)) {
        if (enabled) deny.delete(name);
        else deny.add(name);
      }
      capabilities.toolGate = { ...toolGate, deny: [...deny] };
    }
    // §5.49 — 技能名单的乐观覆盖：点下去就按目标名单画（user m13923：单选一个
    // 技能时整列变灰、还慢）。`dirs` 用 `/state` 里那份可用技能表反查，所以提示
    // 行「现在挂着 N 个技能目录」也立刻跟着变，不用等宿主半回包。
    const skillsDraft = draft.skills || {};
    if (Object.keys(skillsDraft).length > 0) {
      const skills = { ...(selected.skills || {}) };
      if (Object.prototype.hasOwnProperty.call(skillsDraft, 'mode')) skills.mode = skillsDraft.mode;
      if (Object.prototype.hasOwnProperty.call(skillsDraft, 'ids')) {
        const ids = skillsDraft.ids || [];
        const available = ((state === null ? null : state.skills) || {}).available || [];
        const byName = new Map(available.map((skill) => [skill.name, skill]));
        skills.ids = ids;
        skills.dirs = ids
          .map((name) => (byName.get(name) || {}).dir)
          .filter((dir) => typeof dir === 'string');
      }
      return { ...selected, rows, capabilities, skills };
    }
    return { ...selected, rows, capabilities };
  }, [selected, draft, state]);

  /**
   * §5.39 — the queue, and the one request it turns into.
   *
   * Take everything that piled up, send it as one declarative
   * `set-switches` (host half: one write, one preset rebuild), then drop the
   * optimistic overlay for exactly the keys this request carried — a newer
   * gesture may already be queued by the time the reply lands.
   *
   * Failure is the interesting half: the draft is withdrawn and `/state` is
   * re-read, so the panel rolls back to what the file actually says instead
   * of keeping a flip that never landed.
   */
  return {
    displayRole,
    editDraft,
    hideChatTab,
    markPending,
    writeDraft,
  };
}

export { useTeamRolesDrafts };
