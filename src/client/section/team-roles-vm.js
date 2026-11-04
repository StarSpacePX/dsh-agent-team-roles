// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 容器第 4 段：派生值 + 事件处理器，汇成视图 vm。

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

// 同一个规范化也用在选中角色的 id 输入框上（详情面板，名字下面一行）。
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

// 挂载失败是 state.registered 看不出来的唯一一种情况：注册表 register() 无论成败都
// 返回 disposer，激活失败只体现为 roster 上的 broken 诊断而不抛错。
// 不读那份 roster，构成有问题的角色会看起来和健康的一样。
  const brokenById = new Map();
  for (const record of state.registry || []) {
    if (record && typeof record.broken === 'string' && record.broken.length > 0) {
      brokenById.set(record.id, record.broken);
    }
  }

// deferred 一直有兜底，registered 没有：宿主只发得出某些形状时（旧版宿主、
// 状态拼装中途失败、字段被清空），state.registered.includes(...) 会当场抛错把整个设置面板变白。
// 口径是：形状不对就当作「不知道」，既不误报未注册，也不白屏；拿到数组才照实判断。
  const deferredIds = Array.isArray(state.deferred) ? state.deferred : [];
  const registeredIds = Array.isArray(state.registered) ? state.registered : null;

// 来源说明不放在这里：每行「从哪来」的答案见「模式」面板的逐模式提示。
// 一个开关一个 pending 键：勾一下只灰自己。
// 而且一个队列：点击立刻画（草稿），变更记进队列，由 burst 定时器并成一条请求。
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
// 插件可见性与 MCP 那一格同一条队列、同一个 burst 定时器，点一排工具也只出一条 set-switches。
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
// 「全开 / 全关」只有分组标题行（以及 MCP 标题行）那个复选框一个入口。
// 整批只发一条请求：commitSwitches 记进队列，120ms 后合成一条 set-switches，
// 宿主侧一次写盘、一次重建 —— 不是每行一条 set-override。
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
// 「插件」那块的全开 / 全关，同 MCP：一条请求带整批目标状态。
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
// 一个名字前缀组的全开 / 全关：组头与逐行开关写的是同一种东西（精确工具名），
// 所以一条 set-switches 带整组目标状态，宿主侧一次写盘、一次重建。
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
