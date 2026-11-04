// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 容器第 1 段（原 1726-1959）：状态、错误、加载、adopt/run/refresh。

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
  /** the id typed next to the new role's name ('': auto). */
  const [newId, setNewId] = React.useState('');
  /**
   * 「还得给我改 id 的地方啊，就放在名字下面一行」(user m20310)：选中角色之后
   * 也能改 id。这里存的是**裸成员名**（id 去掉 `team-` 前缀），跟新建那一行同一种
   * 写法；保存时 `update-role` 收 `newId`，宿主把目录、role.json 和注册的 preset
   * 一起换成新 id（§5.57）。
   */
  const [idDraft, setIdDraft] = React.useState('');
  // 「全开 / 全关」没有自己的 `bulk` 覆盖状态：它和单个开关走
  // 同一套乐观覆盖（`draft`），所以整组的勾选框也是点下去就变。
  /** §5.33 — the last `set-team` outcome, so 「需要重启」 is not silently dropped. */
  const [teamResult, setTeamResult] = React.useState(null);
  /**
   * §B1 — 「哪个角色的哪些字段，是用户改过、还没保存的草稿」。
   *
   * 详情表单（名字 / 角色 ID / 描述 / 排序）是一份**未保存的草稿**，而每一次
   * `/state` 回包（`adopt()`）都会造出一批全新的 role 对象。同步
   * effect 若依赖 `selected` 这个**对象**，"对象换新"就会重跑，把用户
   * 正在打的字静默换成磁盘上的旧值（真机实测：改完名字按一下刷新就没了）。
   *
   * 形状 `{ id, fields: { name?, description?, order?, id? } }`：按**字段**记
   * 而不是按角色记。若只记「这个角色有草稿」，用户改完名字点一下「刷新」，
   * 描述/排序就会被冻在旧值上，接着「保存角色信息」会把陈旧的描述/排序写回
   * 服务端 —— 那是同一种「编辑丢失」，只是换了个方向。
   */
  const [dirty, setDirty] = React.useState(null);
  /** §B2 — 失败提示的计时器；错误不再靠 refresh 顺手清掉（见 ERROR_TTL_MS）。 */
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
  /**
   * §5.35 — 逐控件的「进行中」集合（user m08302：勾一下整张表的勾选框全变灰、还慢）。
   *
   * A switch is pending on its own key (`row:<id>` / `mcp:<server>`) and only
   * itself, so one click never greys all 32 rows plus the MCP list.
   */
  const [pending, setPending] = React.useState(() => new Set());
  /**
   * §5.35 — 乐观覆盖：点下去立刻按目标状态画，回包之后再以 `/state` 为准。
   *
   * The host half answers a toggle with a full state, but that round trip
   * includes re-syncing every role's preset — long enough that a checkbox
   * that only moves after the reply feels broken. This draws the target
   * state immediately; the reply replaces it (and a failure drops it, so
   * the box snaps back to what the file actually says).
   */
  const [draft, setDraft] = React.useState(null);
  /**
   * §5.39 — 一次手势 = 一个请求（客户端的这一半）。
   *
   * Every switch change goes into this queue first and leaves as a single
   * `set-switches` after `SWITCH_BURST_MS`, so five quick clicks are one
   * round trip instead of five — and the host half rebuilds every role's
   * preset once instead of once per row. It is the debounce+coalesce half of
   * the same idea as the host's batch action, and it replaced four separate
   * "send my own request" code paths with one.
   */
  const queue = React.useRef({ roleId: null, rows: {}, mcp: {}, tools: {}, keys: new Set(), timer: null });
  /**
   * `flushSwitches` needs `refresh`, and `run` needs `flushSwitches` … but
   * `run` is defined first. This ref is that one-way door: it is filled in
   * once the callback exists, and `run` only ever calls it if it is there.
   */
  const flushSwitches$ = React.useRef(null);
  /** §5.49 — the same one-way door for the skill list's queue. */
  const flushSkills$ = React.useRef(null);

  const selected = state === null ? null : state.roles.find((role) => role.id === selectedId) || null;

  const adopt = React.useCallback((next, keepSelection) => {
    // §5.34 — the explanation map arrives with every state, so a refresh is
    // enough to pick up an edited notes.json.
    setNoteValues((next.notes && next.notes.values) || {});
    setState(next);
    setSelectedId((current) => {
      if (keepSelection && next.roles.some((role) => role.id === current)) return current;
      return next.roles.length > 0 ? next.roles[0].id : null;
    });
  }, []);

  /**
   * §E2 — 刷新的「期号」。慢的那次 `refresh()` 后回来时，不能拿旧回包盖掉更新的
   * 结果：进入时领一个号，回包到手时号码已经不是最新的就直接丢弃。
   */
  const refreshTicket$ = React.useRef(0);

  const run = React.useCallback(
    async (body, options) => {
      // §5.35 — `quiet` is for a control that carries its own optimistic
      // overlay (the context panel's provider switch). Structural actions
      // (create / delete / reset / set-mode / set-team) still take the global
      // lock: while one of those is in flight the whole panel really is
      // unknown. Switch flips do not come through here at all any more —
      // they go through the `commitSwitches` queue below (§5.39).
      const quiet = options !== undefined && options.quiet === true;
      // §5.39 — a queued switch batch edits the same role as most of these
      // actions (reset / set-mode / set-bind-members), so it has to land
      // first: otherwise a click still sitting in the queue would be applied
      // on top of the reset a moment later.
      if (flushSwitches$.current !== null) await flushSwitches$.current();
      // §5.49 — a queued skill choice edits the same role.json, so it has the
      // same "land first" rule as a queued switch batch.
      if (flushSkills$.current !== null) await flushSkills$.current();
      if (!quiet) setBusy(true);
      clearError();
      try {
        const payload = await command(body);
        if (payload && payload.state) {
          // §E2 — 这条命令的回包比任何在途的 refresh 都新，先把它作废。
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
    // §E2 — 领号：这一趟的回包只有在自己还是最新时才允许落地。
    const ticket = refreshTicket$.current + 1;
    refreshTicket$.current = ticket;
    try {
      const payload = await fetchState();
      if (refreshTicket$.current !== ticket) return;
      adopt(payload, true);
      // §B2 — 这里不能无条件 `setError('')`：任何一次成功的刷新都会把刚刚失败
      // 的提示抹掉，而 flushSwitches / flushSkills 的 catch 里紧跟着就是 refresh，
      // 提示只活 ~43ms（真机实测值）。错误由 showError 计时，这里不动它。
    } catch (failure) {
      // §E2 — 过期的失败同样不该弹提示：用户看到的那一屏早就不是它对应的状态了。
      if (refreshTicket$.current !== ticket) return;
      showError(String((failure && failure.message) || failure));
    }
  }, [adopt, showError]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * §B1 — 「这个角色的哪些字段已经有草稿」。
   *
   * `markDirty` 只加不覆盖（函数式更新），并且必须定义在 `selected` 之后。
   */
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

  /**
   * §B1 — 上一次"把服务端值写进 id 框"时那个角色的**完整 id**（`team-select` 这种）。
   * 只在下面那个同步 effect 真正写表单时更新。
   */
  const idBaseline$ = React.useRef(null);
  /**
   * §B1 — 同步 effect 刚刚写过 id 框，这一笔是同步来的、不是用户敲的。
   *
   * 必须用这个标记，不能只比 `idDraft` 和基线：同步 effect 写基线的那一帧，
   * `idDraft` 还是上一帧的值，光靠比较会把**挂载时**的一次同步误判成用户编辑，
   * 于是整个表单从打开那一刻起就是 dirty。
   */
  const idSyncPending$ = React.useRef(false);
  React.useEffect(() => {
    if (selected === null) return;
    // §B1 — 改过的字段不覆盖；没碰过的字段照常跟服务端走。
    if (!isDirty('name')) setName(selected.name || '');
    if (!isDirty('description')) setDescription(selected.description || '');
    if (!isDirty('order')) setOrder(String(selected.order ?? 10));
    // 详情里的 id 框显示**裸成员名**（跟新建那一行同一种写法）。
    const prefix =
      state && typeof state.presetPrefix === 'string' && state.presetPrefix.length > 0
        ? state.presetPrefix
        : 'team-';
    idBaseline$.current = selected.id;
    if (!isDirty('id') && idDraft !== nakedMemberName(selected.id, prefix)) {
      idSyncPending$.current = true;
      setIdDraft(selected.id.startsWith(prefix) ? selected.id.slice(prefix.length) : selected.id);
    }
    // §B1 — 依赖全是**原始值**。role 对象每次回包都是新的引用，但服务端值没变时
    // 不该重填表单：这正是"编辑被静默抹掉"的根因（旧依赖是 `[selected]`）。
  }, [
    selected === null ? null : selected.id,
    selected === null ? '' : selected.name || '',
    selected === null ? '' : selected.description || '',
    selected === null ? 10 : selected.order ?? 10,
    state === null ? 'team-' : state.presetPrefix,
    dirty,
  ]);

  /**
   * §B3 —— 切换角色必须**一次提交**做完：清草稿 + 换选中项 + 填新角色的服务端值。
   *
   * 只 `setSelectedId` 的话，填表要等下面那个同步 `useEffect`（跑在**绘制之后**），
   * 中间那一帧是「新角色已选中、表单里还是上一个角色的值」：`idDraftTaken` 当场为真，
   * 红字「已经有角色在用这个 ID：…」闪一下把下面的内容顶下去（用户 m04322：
   * 「切换过程中会出现一闪而过的一行红字…整个页面的文字被挤开了，闪烁很打眼」）。
   * 在一次事件里把 `setState` 全下完，React 只提交一帧，没有那个中间态。
   */
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
    // 基线先写好：`[idDraft]` 那个 effect 就是拿基线比对的，这一笔不会被误判成用户编辑。
    idBaseline$.current = next.id;
    setIdDraft(nakedMemberName(next.id, prefix));
  };

  // §B1 — 名字 / 描述 / 排序三个框走 `editDraft`，一改就标脏（并按字段记）。
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
