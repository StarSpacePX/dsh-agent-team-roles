// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 容器第 2 段：字段草稿、dirty 基线、displayRole。

import { nakedMemberName } from './../constants.js';
import { chatTab } from './../entries.js';
import { React } from './../react.js';

function useTeamRolesDrafts(core) {
  const { draft, idBaseline$, idDraft, idSyncPending$, markDirty, selected, setDraft, setPending, state } = core;
  const editDraft = (field, setter) => (event) => {
    setter(event.target.value);
    markDirty(field);
  };

/** 角色 ID 框不能改 onChange 的写法：必须保持
 * `onChange: (event) => setIdDraft(event.target.value)`（有源码形状断言在盯着）。
 * 脏判定改成「与同步时记下的基线比」：idDraft 一旦偏离 idBaseline$，就说明是用户敲的。
 * 依赖只放 [idDraft]：切角色时上一帧先写好基线，下一帧 idDraft 才变，
 * 那一帧靠 idSyncPending$ 放行，不会误判成 dirty。 */
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

// R6 — 会话页签跟随开关实时变化：隐藏 / 显示走 slot 的 disposer，不用重载。
  const hideChatTab = state === null ? undefined : state.hideChatTab;
  React.useEffect(() => {
    if (hideChatTab === undefined) return;
    chatTab.setHidden(hideChatTab === true);
  }, [hideChatTab]);

/** 带乐观覆盖的开关，覆盖写在这份 overlay 里。
 * writeDraft 合并补丁；值为 undefined 表示**丢掉**这个键（回包已到，/state 才是真相）。 */
  const markPending = React.useCallback((key, on) => {
    setPending((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

/** 写入某个角色的乐观覆盖。
 * keepOtherRole 给回包路径用：用户已经切走，迟到的 set-switches 回包不能复活或抹掉别的角色的覆盖；
 * 用户手势照旧接管草稿，因为他看的就是眼前这个角色。 */
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

// 面板实际渲染的：选中角色 + 本会话还没确认的翻转叠在上面，其余都来自 /state。
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
// 插件可见性的同款乐观覆盖：勾掉一个工具就按目标名单画，
// 不等宿主侧回包（回包后 overlay 被 drop，/state 才是真相）。
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
// 技能名单的乐观覆盖：点下去就按目标名单画。
// dirs 用 /state 里那份可用技能表反查，提示行「现在挂着 N 个技能目录」也立刻跟着变。
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

/** 队列，以及它最终变成的那一条请求：
 * 把堆起来的变更合成一条声明式 set-switches（宿主侧一次写盘、一次重建预设），
 * 回包后只 drop 本次携带的键 —— 回包到达时用户可能已经又点了新的。
 * 失败时草稿要被退回，否则界面会停在没写进磁盘的状态上。 */
  return {
    displayRole,
    editDraft,
    hideChatTab,
    markPending,
    writeDraft,
  };
}

export { useTeamRolesDrafts };
