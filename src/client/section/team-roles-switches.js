// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 容器第 3 段（原 2120-2256）：开关 burst 队列与提交。

import { SKILL_BURST_MS, SWITCH_BURST_MS } from './../constants.js';
import { command } from './../net.js';
import { React } from './../react.js';

function useTeamRolesSwitches(core, drafts) {
  const { adopt, clearError, error, flushSkills$, flushSwitches$, queue, refresh, selectedId, showError, state } = core;
  const { markPending, writeDraft } = drafts;
  const flushSwitches = React.useCallback(async () => {
    const batch = queue.current;
    if (batch.timer !== null) clearTimeout(batch.timer);
    // Synchronous take: `commitSwitches` relies on this, because it calls
    // flush and then immediately starts filling the next batch.
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
      // §B2 — 这次操作成功了，把上一次失败留下的提示收掉（失败提示改由 showError 计时）。
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

  /**
   * The only way a switch changes: paint it now (draft), remember it in the
   * queue, arm the burst timer. Nothing here awaits a request — that is what
   * makes the checkbox follow the click instantly.
   */
  const commitSwitches = (patch, keys) => {
    // The user moved to another role: land the previous role's queue first.
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

  /**
   * §5.49 — 技能名单的队列（user m13923「单选时为啥整个技能列都灰色，还这么慢」）。
   *
   * Same shape as the switch queue above. The click paints its row through the
   * `draft.skills` overlay,
   * marks **that row** pending, and the burst timer folds a run of clicks
   * into one `set-skills` — so one click on one skill never greys all 18
   * rows plus the header box.
   */
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
      // §B2 — 同 flushSwitches：成功即收掉上一次的失败提示。
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

  /**
   * The only way a skill is ticked: paint it now (draft), remember the whole
   * target list in the queue, arm the burst timer. `keys` is what greys for
   * this round trip — one row for a single tick, every row for the header box
   * or the restore key.
   */
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

  // the create row's optional id. `draftRoleId` is the full
  // preset id (prefix included) that 「新建角色」 will send, and
  // `draftMemberName` is what `spawn_teammate` must be called with.
  return {
    commitSkills,
    commitSwitches,
    flushSkills,
    flushSwitches,
    skillsQueue,
  };
}

export { useTeamRolesSwitches };
