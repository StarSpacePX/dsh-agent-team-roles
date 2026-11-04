// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 容器第 1 段：状态、错误、加载、adopt/run/refresh。

import { ERROR_TTL_MS, nakedMemberName } from './../constants.js';
import { command, fetchState } from './../net.js';
import { setNoteValues } from './../notes.js';
import { React } from './../react.js';

function useTeamRolesCore() {
  const [state, setState] = React.useState(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState(null);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [order, setOrder] = React.useState('10');
  const [newName, setNewName] = React.useState('');
/** 新建角色那一行里填的 id（空串表示自动）。 */
  const [newId, setNewId] = React.useState('');
/** 选中角色后也能改 id：存裸成员名（id 去掉 team- 前缀），与新建那一行同一种写法；
 * 保存时 update-role 收 newId，宿主把目录、role.json 与注册的 preset 一起换。 */
  const [idDraft, setIdDraft] = React.useState('');
// 「全开 / 全关」没有单独的 bulk 覆盖状态：与单个开关走同一套乐观覆盖，整组勾选框点下去就变。
/** 最近一次 set-team 的结果，避免「需要重启」被静默丢掉。 */
  const [teamResult, setTeamResult] = React.useState(null);
/** 「哪个角色的哪些字段是用户改过、还没保存的草稿」。
 * 每次 /state 回包都会造一批新的 role 对象；同步 effect 若依赖 selected 这个对象，
 * 对象换新就会重跑，把用户正在打的字换成磁盘旧值。所以按字段记，而不是按角色记。
 * 形状 `{ id, fields: { name?, description?, order?, id? } }`。 */
  const [dirty, setDirty] = React.useState(null);
/** 失败提示的计时器；错误不再靠 refresh 顺手清掉。 */
  const errorTimer$ = React.useRef(null);
  const clearError = React.useCallback(() => {
    if (errorTimer$.current !== null) {
      clearTimeout(errorTimer$.current);
      errorTimer$.current = null;
    }
    setError('');
  }, []);
  const showError = React.useCallback((message) => {
    if (errorTimer$.current !== null) clearTimeout(errorTimer$.current);
    setError(message);
    errorTimer$.current = setTimeout(() => {
      errorTimer$.current = null;
      setError('');
    }, ERROR_TTL_MS);
  }, []);
// 面板卸载时别把计时器留在后台。
  React.useEffect(
    () => () => {
      if (errorTimer$.current !== null) clearTimeout(errorTimer$.current);
    },
    [],
  );
/** 逐控件的「进行中」集合：一个开关只让自己 pending，一次点击不会让整张表变灰。 */
  const [pending, setPending] = React.useState(() => new Set());
/** 乐观覆盖：点下去立刻按目标状态画，回包之后再以 /state 为准。
 * 宿主回包要重同步每个角色的预设，慢到勾选框只在回包后才动会像坏了一样。 */
  const [draft, setDraft] = React.useState(null);
/** 一次手势 = 一个请求（客户端这一半）：每次开关变更先入队，
 * SWITCH_BURST_MS 后并成一个 set-switches，五次快速点击只走一次回包、只重建一次。 */
  const queue = React.useRef({ roleId: null, rows: {}, mcp: {}, tools: {}, keys: new Set(), timer: null });
/** run 定义在前面却要用 flushSwitches：这个 ref 单向补齐，填上之后才会被调用。 */
  const flushSwitches$ = React.useRef(null);
/** 技能列表的队列用同一个单向门。 */
  const flushSkills$ = React.useRef(null);

  const selected = state === null ? null : state.roles.find((role) => role.id === selectedId) || null;

  const adopt = React.useCallback((next, keepSelection) => {
// 说明表随每次 state 回包下发，刷新就够拾起改过的 notes.json。
    setNoteValues((next.notes && next.notes.values) || {});
    setState(next);
    setSelectedId((current) => {
      if (keepSelection && next.roles.some((role) => role.id === current)) return current;
      return next.roles.length > 0 ? next.roles[0].id : null;
    });
  }, []);

/** 刷新的期号：慢的那次 refresh 后回来时不能盖掉更新的结果，号码过期就丢弃。 */
  const refreshTicket$ = React.useRef(0);

  const run = React.useCallback(
    async (body, options) => {
// quiet 给自带乐观覆盖的控件（上下文面板的 provider 开关）用。
// 结构性动作（新建/删除/还原/改模式/团队开关）仍拿全局锁：它们进行中整个面板都是未知状态。
      const quiet = options !== undefined && options.quiet === true;
// 排队中的开关批次改的是同一个角色，必须先落地，否则会盖在之后的还原上面。
      if (flushSwitches$.current !== null) await flushSwitches$.current();
// 排队中的技能选择也改同一个 role.json，同样先落地。
      if (flushSkills$.current !== null) await flushSkills$.current();
      if (!quiet) setBusy(true);
      clearError();
      try {
        const payload = await command(body);
        if (payload && payload.state) {
// 这条命令的回包比任何在途 refresh 都新，先把它们作废。
          refreshTicket$.current += 1;
          adopt(payload.state, true);
        }
        clearError();
        return payload;
      } catch (failure) {
        showError(String((failure && failure.message) || failure));
        return null;
      } finally {
        if (!quiet) setBusy(false);
      }
    },
    [adopt, clearError, showError],
  );

  const refresh = React.useCallback(async () => {
// 领号：只有这一趟仍是最新时，回包才允许落地。
    const ticket = refreshTicket$.current + 1;
    refreshTicket$.current = ticket;
    try {
      const payload = await fetchState();
      if (refreshTicket$.current !== ticket) return;
      adopt(payload, true);
// 不能无条件 setError('')：任何成功的刷新都会把刚失败的提示抹掉（提示只活约 43ms），
// 错误由 showError 计时，这里不动它。
    } catch (failure) {
// 过期的失败同样不该弹提示：用户看到的那一屏早就不对应这个状态。
      if (refreshTicket$.current !== ticket) return;
      showError(String((failure && failure.message) || failure));
    }
  }, [adopt, showError]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

/** 这个角色的哪些字段已经有草稿。markDirty 只加不覆盖，且必须定义在 selected 之后。 */
  const markDirty = (field) => {
    setDirty((current) => {
      if (selected === null) return current;
      const fields = current !== null && current.id === selected.id ? current.fields : {};
      if (fields[field] === true) return current;
      return { id: selected.id, fields: { ...fields, [field]: true } };
    });
  };
  const clearDirty = () => setDirty(null);
  const isDirty = (field) =>
    dirty !== null && selected !== null && dirty.id === selected.id && dirty.fields[field] === true;

/** 上一次把服务端值写进 id 框时那个角色的完整 id，只在同步 effect 真正写表单时更新。 */
  const idBaseline$ = React.useRef(null);
/** 同步 effect 刚写过 id 框：这一笔是同步来的，不是用户敲的。
 * 必须用标记而不是比较 idDraft 与基线：同步那一帧 idDraft 还是上一帧的值，
 * 光靠比较会把挂载时的一次同步误判成用户编辑。 */
  const idSyncPending$ = React.useRef(false);
  React.useEffect(() => {
    if (selected === null) return;
// 改过的字段不覆盖，没碰过的字段照常跟服务端走。
    if (!isDirty('name')) setName(selected.name || '');
    if (!isDirty('description')) setDescription(selected.description || '');
    if (!isDirty('order')) setOrder(String(selected.order ?? 10));
// 详情里的 id 框显示裸成员名（与新建那一行同一种写法）。
    const prefix =
      state && typeof state.presetPrefix === 'string' && state.presetPrefix.length > 0
        ? state.presetPrefix
        : 'team-';
    idBaseline$.current = selected.id;
    if (!isDirty('id') && idDraft !== nakedMemberName(selected.id, prefix)) {
      idSyncPending$.current = true;
      setIdDraft(selected.id.startsWith(prefix) ? selected.id.slice(prefix.length) : selected.id);
    }
// 依赖全是原始值：role 对象每次回包都是新引用，但服务端值没变时不该重填表单。
  }, [
    selected === null ? null : selected.id,
    selected === null ? '' : selected.name || '',
    selected === null ? '' : selected.description || '',
    selected === null ? 10 : selected.order ?? 10,
    state === null ? 'team-' : state.presetPrefix,
    dirty,
  ]);

/** 切换角色必须一次提交做完：清草稿、换选中项、填新角色的服务端值。
 * 只 setSelectedId 的话，填表要等绘制之后的同步 effect，中间那一帧是新角色配旧值，
 * 红字会闪一下把下面的内容顶下去。一次事件里把状态全下完，React 只提交一帧。 */
  const selectRole = (roleId) => {
    const next = ((state === null ? null : state.roles) || []).find((role) => role.id === roleId) || null;
    setDirty(null);
    setSelectedId(roleId);
    if (next === null) return;
    setName(next.name || '');
    setDescription(next.description || '');
    setOrder(String(next.order ?? 10));
    const prefix =
      state && typeof state.presetPrefix === 'string' && state.presetPrefix.length > 0
        ? state.presetPrefix
        : 'team-';
// 基线先写好：idDraft 那个 effect 拿基线比对，这一笔不会被误判成用户编辑。
    idBaseline$.current = next.id;
    setIdDraft(nakedMemberName(next.id, prefix));
  };

// 名字 / 描述 / 排序三个框走 editDraft，一改就按字段标脏。
  return {
    adopt,
    busy,
    clearDirty,
    clearError,
    description,
    dirty,
    draft,
    error,
    errorTimer$,
    flushSkills$,
    flushSwitches$,
    idBaseline$,
    idDraft,
    idSyncPending$,
    isDirty,
    markDirty,
    name,
    newId,
    newName,
    order,
    selectRole,
    pending,
    queue,
    refresh,
    refreshTicket$,
    run,
    selected,
    selectedId,
    setBusy,
    setDescription,
    setDirty,
    setDraft,
    setError,
    setIdDraft,
    setName,
    setNewId,
    setNewName,
    setOrder,
    setPending,
    setSelectedId,
    setState,
    setTeamResult,
    showError,
    state,
    teamResult,
  };
}

export { useTeamRolesCore };
