// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 容器第 4 段（原 2257-2411）：派生值 + 事件处理器，汇成视图 vm。

import { roleIdFromInput } from './role-id.js';

function buildTeamRolesVm(core, drafts, switches) {
  const { idDraft, newId, pending, run, selected, selectedId, state } = core;
  const { markPending, writeDraft } = drafts;
  const { commitSwitches } = switches;
  const newRoleIdPrefix =
    typeof state.presetPrefix === 'string' && state.presetPrefix.length > 0 ? state.presetPrefix : 'team-';
  const draftRoleId = roleIdFromInput(newId, newRoleIdPrefix);
  const draftMemberName = draftRoleId.startsWith(newRoleIdPrefix)
    ? draftRoleId.slice(newRoleIdPrefix.length)
    : draftRoleId;

  // 同一个规范化也用在**选中角色**的 id 输入框上（详情面板，名字下面一行）。
  const selectedIdDraft = roleIdFromInput(idDraft, newRoleIdPrefix);
  const selectedMemberName = selectedIdDraft.startsWith(newRoleIdPrefix)
    ? selectedIdDraft.slice(newRoleIdPrefix.length)
    : selectedIdDraft;
  const idDraftInvalid = idDraft.trim().length > 0 && selectedIdDraft === '';
  const idDraftTaken =
    selectedIdDraft !== '' &&
    selectedIdDraft !== (selected ? selected.id : null) &&
    state.roles.some((role) => role.id === selectedIdDraft);
  const idDraftChanged = selected !== null && selectedIdDraft !== selected.id;

  // Mount failures are the one thing `state.registered` cannot show: the
  // registry's `register()` resolves with a disposer either way and reports a
  // failed activation as a `broken` diagnostic on its roster instead of
  // throwing. Without reading that roster a role whose composition is
  // malformed — a bad row id, a config value the plugin rejects — would look
  // exactly like a healthy one, and the UI would stay silent about it.
  const brokenById = new Map();
  for (const record of state.registry || []) {
    if (record && typeof record.broken === 'string' && record.broken.length > 0) {
      brokenById.set(record.id, record.broken);
    }
  }

  // §E3 — `deferred` 一直有兜底，`registered` 没有：宿主半只发得出 `registered`
  // 的某些形状时（旧版宿主、状态拼装中途失败、字段被清空），
  // `state.registered.includes(...)` 会当场抛错把整个设置面板变成空白页。
  // 口径是：形状不对就当作"不知道"，既不误报「未注册」，也不白屏；
  // 只有真拿到数组时才照实判断。
  const deferredIds = Array.isArray(state.deferred) ? state.deferred : [];
  const registeredIds = Array.isArray(state.registered) ? state.registered : null;

  // No provenance sentence up here (m07345 「去掉说明」): each row's
  // where-does-this-come-from answer is the 「模式」 panel's per-mode tooltip,
  // which says the composition is read live and how many rows it has.
  // §5.35 — one switch, one pending key (user m08302: 「为啥我勾选/取消时，
  // 全部的勾选框都变灰色？变化也很慢」).
  //
  // §5.39 — and one *queue*: the click paints immediately (draft), the change
  // is remembered and leaves as part of the next burst request, so this row
  // greys for its own round trip and *nothing else moves*; if the write fails
  // the draft is withdrawn and the box snaps back to what the file says.
  const onToggle = (row, enabled) => {
    const key = `row:${row.id}`;
    if (pending.has(key)) return undefined;
    commitSwitches({ rows: { [row.id]: !enabled } }, [key]);
    return undefined;
  };
  const onMcpToggle = (server, enabled) => {
    const key = `mcp:${server}`;
    if (pending.has(key)) return undefined;
    commitSwitches({ mcp: { [server]: enabled === true } }, [key]);
    return undefined;
  };
  // §5.55 — 插件可见性：和 MCP 那一格同一条队列、同一个 burst 定时器，
  // 所以点一排工具也只出一条 `set-switches`。
  const onToolToggle = (name, enabled) => {
    const key = `tool:${name}`;
    if (pending.has(key)) return undefined;
    commitSwitches({ tools: { [name]: enabled === true } }, [key]);
    return undefined;
  };
  const onContextToggle = (inherit) => {
    const key = 'context:tool-subagent';
    if (pending.has(key)) return undefined;
    markPending(key, true);
    writeDraft(selectedId, {
      config: { 'tool-subagent': inherit ? { provider: 'fork' } : { provider: null } },
    });
    return run(
      {
        action: 'set-override',
        id: selectedId,
        row: 'tool-subagent',
        ...(inherit ? { config: { provider: 'fork' } } : { clearConfig: ['provider'] }),
      },
      { quiet: true },
    ).finally(() => {
      markPending(key, false);
      writeDraft(selectedId, { config: { 'tool-subagent': undefined } });
    });
  };
  // 「全开 / 全关」只有一个入口：分组标题行（以及 MCP 标题行）
  // 那个复选框。
  //
  // §5.39 — 而且整批只发**一条**请求：`commitSwitches` 把它记进队列、120ms 后
  // 合成一条 `set-switches` 出去，宿主半一次写盘、一次重建 —— 不是一行一条
  // `set-override`（19 个工具行 = 19 次 rebuild），也没有全局锁把整张表变灰。
  const onBulk = (rows, enabled, category) => {
    const key = `group:${category}`;
    if (pending.has(key)) return undefined;
    const targets = rows.filter((row) => (row.disabled !== true) !== enabled);
    if (targets.length === 0) return undefined;
    const patch = { rows: {} };
    for (const row of targets) patch.rows[row.id] = !enabled;
    commitSwitches(patch, [key]);
    return undefined;
  };
  const onMcpBulk = (enabled) => {
    const key = 'mcp:*';
    if (pending.has(key)) return undefined;
    const services = (state === null || state.mcp === undefined ? null : state.mcp.services) || [];
    const denied = new Set(
      (((selected === null ? null : selected.capabilities) || {}).mcp || {}).deny || [],
    );
    const targets = services.filter((service) => denied.has(service.serverName) === enabled);
    if (targets.length === 0) return undefined;
    const patch = { mcp: {} };
    for (const service of targets) patch.mcp[service.serverName] = enabled === true;
    commitSwitches(patch, [key]);
    return undefined;
  };
  // §5.55 — 「插件」那一块的全开 / 全关，同 MCP：一条请求带整批目标状态。
  const onToolBulk = (enabled) => {
    const key = 'tool:*';
    if (pending.has(key)) return undefined;
    const tools = (state === null || state.toolGate === undefined ? null : state.toolGate.tools) || [];
    const denied = new Set(
      (((selected === null ? null : selected.capabilities) || {}).toolGate || {}).deny || [],
    );
    const targets = tools.filter((tool) => denied.has(tool.name) === enabled);
    if (targets.length === 0) return undefined;
    const patch = { tools: {} };
    for (const tool of targets) patch.tools[tool.name] = enabled === true;
    commitSwitches(patch, [key]);
    return undefined;
  };
  // §5.55 — 一个名字前缀组的全开 / 全关（user m18765「一个大类的要能整体勾选」）：组头
  // 和逐行开关写的是同一种东西（精确工具名），所以一条 `set-switches` 带整组目标状态，
  // 宿主半一次写盘、一次重建。
  const onToolGroup = (group, names, enabled) => {
    const key = `toolgroup:${group}`;
    if (pending.has(key)) return undefined;
    const denied = new Set(
      (((selected === null ? null : selected.capabilities) || {}).toolGate || {}).deny || [],
    );
    const patch = { tools: {} };
    const keys = [key];
    for (const name of names) {
      if (denied.has(name) === enabled) patch.tools[name] = enabled === true;
      keys.push(`tool:${name}`);
    }
    if (Object.keys(patch.tools).length === 0) return undefined;
    commitSwitches(patch, keys);
    return undefined;
  };

  return {
    ...core,
    ...drafts,
    ...switches,
    brokenById,
    deferredIds,
    draftMemberName,
    draftRoleId,
    idDraftChanged,
    idDraftInvalid,
    idDraftTaken,
    newRoleIdPrefix,
    onBulk,
    onContextToggle,
    onMcpBulk,
    onMcpToggle,
    onToggle,
    onToolBulk,
    onToolGroup,
    onToolToggle,
    registeredIds,
    selectedIdDraft,
    selectedMemberName,
  };
}

export { buildTeamRolesVm };
