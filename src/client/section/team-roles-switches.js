// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 容器第 3 段：开关 burst 队列与提交。

import { SKILL_BURST_MS, SWITCH_BURST_MS } from './../constants.js';
import { command } from './../net.js';
import { React } from './../react.js';

function useTeamRolesSwitches(core, drafts) {
  const { adopt, clearError, error, flushSkills$, flushSwitches$, queue, refresh, selectedId, showError, state } = core;
  const { markPending, writeDraft } = drafts;
  const flushSwitches = React.useCallback(async () => {
    const batch = queue.current;
    if (batch.timer !== null) clearTimeout(batch.timer);
// 同步取出：commitSwitches 先 flush 再立刻开始填下一批，所以不能 async。
    queue.current = { roleId: null, rows: {}, mcp: {}, tools: {}, keys: new Set(), timer: null };
    if (batch.roleId === null || batch.keys.size === 0) return undefined;

    const drop = { rows: {}, mcp: {}, tools: {} };
    for (const rowId of Object.keys(batch.rows)) drop.rows[rowId] = undefined;
    for (const server of Object.keys(batch.mcp)) drop.mcp[server] = undefined;
    for (const name of Object.keys(batch.tools)) drop.tools[name] = undefined;

    try {
      const payload = await command({
        action: 'set-switches',
        id: batch.roleId,
        rows: batch.rows,
        mcp: batch.mcp,
        tools: batch.tools,
      });
      for (const key of batch.keys) markPending(key, false);
      writeDraft(batch.roleId, drop, { keepOtherRole: true });
// 成功就把上一次失败留下的提示收掉（失败提示由 showError 计时）。
      clearError();
      if (payload && payload.state) adopt(payload.state, true);
      else await refresh();
    } catch (failure) {
      showError(String((failure && failure.message) || failure));
      for (const key of batch.keys) markPending(key, false);
      writeDraft(batch.roleId, drop, { keepOtherRole: true });
      await refresh();
    }
    return undefined;
  }, [adopt, clearError, markPending, refresh, showError, writeDraft]);
  React.useEffect(() => {
    flushSwitches$.current = flushSwitches;
  }, [flushSwitches]);

/** 开关唯一的变更入口：先画（draft）、记进队列、开 burst 计时，
 * 全过程不 await 请求 —— 勾选框才能跟手。 */
  const commitSwitches = (patch, keys) => {
// 用户切到别的角色：先把上一个角色的队列落地。
    if (queue.current.roleId !== null && queue.current.roleId !== selectedId) {
      void flushSwitches();
    }
    const batch = queue.current;
    batch.roleId = selectedId;
    for (const rowId of Object.keys(patch.rows || {})) batch.rows[rowId] = patch.rows[rowId];
    for (const server of Object.keys(patch.mcp || {})) batch.mcp[server] = patch.mcp[server];
    for (const name of Object.keys(patch.tools || {})) batch.tools[name] = patch.tools[name];
    for (const key of keys) batch.keys.add(key);
    writeDraft(selectedId, patch);
    for (const key of keys) markPending(key, true);
    if (batch.timer !== null) clearTimeout(batch.timer);
    batch.timer = setTimeout(() => {
      void flushSwitches();
    }, SWITCH_BURST_MS);
  };

/** 技能名单的队列，与上面开关同一个形状。
 * 点击先经 draft.skills 画上，只把这一行标 pending，
 * burst 计时器把一串点击并成一次 set-skills —— 点一个技能不会让整张表变灰。 */
  const skillsQueue = React.useRef({ roleId: null, mode: null, ids: null, keys: new Set(), timer: null });

  const flushSkills = React.useCallback(async () => {
    const batch = skillsQueue.current;
    if (batch.timer !== null) clearTimeout(batch.timer);
    skillsQueue.current = { roleId: null, mode: null, ids: null, keys: new Set(), timer: null };
    if (batch.roleId === null || batch.keys.size === 0) return undefined;
    const drop = { skills: { mode: undefined, ids: undefined } };
    try {
      const payload = await command({
        action: 'set-skills',
        id: batch.roleId,
        mode: batch.mode,
        ids: batch.ids,
      });
      for (const key of batch.keys) markPending(key, false);
      writeDraft(batch.roleId, drop, { keepOtherRole: true });
// 同 flushSwitches：成功即收掉上一次的失败提示。
      clearError();
      if (payload && payload.state) adopt(payload.state, true);
      else await refresh();
    } catch (failure) {
      showError(String((failure && failure.message) || failure));
      for (const key of batch.keys) markPending(key, false);
      writeDraft(batch.roleId, drop, { keepOtherRole: true });
      await refresh();
    }
    return undefined;
  }, [adopt, clearError, markPending, refresh, showError, writeDraft]);
  React.useEffect(() => {
    flushSkills$.current = flushSkills;
  }, [flushSkills]);

/** 勾技能的入口：先画（draft）、把整个目标列表记进队列、开 burst 计时。
 * keys 是这轮要变灰的行：单选只灰一行，表头勾选与还原键灰全部。 */
  const commitSkills = (next, keys) => {
    if (skillsQueue.current.roleId !== null && skillsQueue.current.roleId !== selectedId) {
      void flushSkills();
    }
    const batch = skillsQueue.current;
    batch.roleId = selectedId;
    batch.mode = next.mode;
    batch.ids = next.ids;
    for (const key of keys) batch.keys.add(key);
    writeDraft(selectedId, { skills: { mode: next.mode, ids: next.ids } });
    for (const key of keys) markPending(key, true);
    if (batch.timer !== null) clearTimeout(batch.timer);
    batch.timer = setTimeout(() => {
      void flushSkills();
    }, SKILL_BURST_MS);
  };

// 新建行的可选 id：draftRoleId 是完整 preset id（带前缀），
// draftMemberName 是 spawn_teammate 要用的名字。
  return {
    commitSkills,
    commitSwitches,
    flushSkills,
    flushSwitches,
    skillsQueue,
  };
}

export { useTeamRolesSwitches };
