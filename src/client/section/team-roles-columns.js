// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 角色列表 + 详情列（原 2578-2841），整段 JSX 逐字保留。

import { nakedMemberName } from './../constants.js';
import { filterEntries, mcpEntries, skillEntries, toolEntries } from './../entries.js';
import { describe, info } from './../notes.js';
import { ContextPanel } from './../panels/context.js';
import { GroupedTable } from './../panels/grouped-table.js';
import { McpPanel } from './../panels/mcp.js';
import { ModePanel } from './../panels/mode.js';
import { PluginsPanel } from './../panels/plugins.js';
import { SkillsPanel } from './../panels/skills.js';
import { WorkdirPanel } from './../panels/workdir.js';
import { h } from './../react.js';
import { styles } from './../styles.js';

function TeamRolesColumns(vm) {
  const { brokenById, busy, clearDirty, commitSkills, deferredIds, description, displayRole, editDraft, idDraft, idDraftChanged, idDraftInvalid, idDraftTaken, name, onBulk, onContextToggle, onMcpBulk, onMcpToggle, onToggle, onToolBulk, onToolGroup, onToolToggle, order, pending, registeredIds, run, selectRole, selected, selectedId, selectedIdDraft, selectedMemberName, setDescription, setIdDraft, setName, setOrder, setSelectedId, newRoleIdPrefix, state } = vm;
    return h(
      'div',
      { style: styles.columns },
      h(
        'div',
        { style: styles.roles },
        h('div', { style: styles.label }, `角色（${state.roles.length}）`),
        state.roles.length === 0
          ? h('div', { style: styles.hint }, '还没有角色。')
          : state.roles.map((role) => {
              // 用户 m04461：「这个描述改成英文名(中文名)形式，别搞这么乱」——
              // 副标题只留「英文名(中文名)」：英文名 = 角色 id 去掉 `team-` 前缀（就是
              // 成员名），中文名 = `role.name`。`team-` 前缀和模式标签都不再挤在这一行
              // （模式在下面「模式」那块单独配置、单独显示）。没起中文名时不写空括号。
              //
              // 用户 m04536：「不要搞两行，只要一行」——所以角色名不再单独占一行，
              // 整行就是这一串（异常态那几行「未注册 / 挂载失败 / 已存盘」照旧只在真出
              // 状况时才多出来）。
              const memberName = nakedMemberName(role.id, newRoleIdPrefix);
              const roleLabel =
                typeof role.name === 'string' && role.name.length > 0 && role.name !== memberName
                  ? `${memberName}(${role.name})`
                  : memberName;
              return h(
                'button',
                {
                  key: role.id,
                  style: { ...styles.roleItem, ...(role.id === selectedId ? styles.roleItemActive : null) },
                  onClick: () => {
                    // §B1/§B3 — 换角色：上一个角色的草稿作废（不保存），新角色按服务端值填充。
                    // 必须一次提交做完（见 `selectRole`）：只换选中项会闪一帧红字、把内容顶开。
                    selectRole(role.id);
                  },
                },
                roleLabel,
                // §5.54 — `registered` 现在包含「已登记但还没挂载」的角色，所以这里
                // 不再是错误，只是告诉用户：改动已经存进 JSON，等这个角色真被用到
                // （创建成员、或被选为会话预设）的那一刻才构建、挂载。
                deferredIds.includes(role.id)
                  ? h('div', { style: styles.hint }, '已存盘 · 下次用到该角色时生效')
                  : registeredIds === null
                    ? null
                    : registeredIds.includes(role.id)
                      ? null
                      : h('div', { style: styles.error }, '未注册'),
                brokenById.has(role.id)
                  ? h(
                      'div',
                      { style: styles.error, title: brokenById.get(role.id) },
                      '挂载失败',
                    )
                  : null,
              );
            }),
      ),
      selected === null
        ? h('div', { style: { ...styles.detail, ...styles.hint } }, '上面先选一个角色。')
        : h(
            'div',
            { style: styles.detail },
            brokenById.has(selected.id)
              ? h(
                  'div',
                  { style: styles.error },
                  `这个角色的预设没能挂载，dsh 不会用上它：${brokenById.get(selected.id)}`,
                )
              : null,
            h(
              'div',
              { style: styles.field },
              h('span', { style: styles.label }, '名字'),
              // §B1 — 走 editDraft：一改就记 dirty，之后任何 /state 回包都不覆盖这份草稿。
              h('input', { style: styles.input, value: name, onChange: editDraft('name', setName) }),
            ),
            // 「还得给我改 id 的地方啊，就放在名字下面一行」(user m20310)。
            // 角色 id 决定成员名（去掉 `team-` 前缀），改它等于把这个角色的目录、
            // role.json 和已注册的 preset 一起换名。已经建好的成员不会跟着改名
            // （成员名用过就不可删、不可改），这句提醒直接写在框下面。
            h(
              'div',
              { style: styles.field },
              h(
                'span',
                { style: { ...styles.label, ...styles.labelInline } },
                '角色 ID（成员名）',
                // 用户 m03983：「把成员名这行描述放旁边说明里面」——常态那行不再占输入框下面一行，
                // 收进标题旁边的 ⓘ（文案键 `roleMemberName`，与宿主 DEFAULT_NOTES 逐字一致）。
                info(
                  'roleMemberName',
                  '成员名：{member}（spawn_teammate 用这个名字）。角色 ID 决定成员名：改 ID 等于换成员名，已经建好的成员不会跟着改名。',
                  { member: selectedMemberName },
                ),
              ),
              h('input', {
                style: styles.input,
                placeholder: '英文，例如 devtest',
                value: idDraft,
                onChange: (event) => setIdDraft(event.target.value),
              }),
              // 只有「非法 / 被占用 / 改了还没保存」这三种要当场看见的状态才留在框下面。
              idDraftInvalid || idDraftTaken || idDraftChanged
                ? h(
                    'div',
                    { style: idDraftInvalid || idDraftTaken ? styles.error : styles.hint },
                    idDraftInvalid
                      ? '角色 ID 只能用英文小写字母、数字和短横线（例如 devtest、qa-1）。'
                      : idDraftTaken
                        ? `已经有角色在用这个 ID：${selectedIdDraft}`
                        : `保存后：角色 ID ${selectedIdDraft} · 成员名 ${selectedMemberName}（spawn_teammate 用这个名字；已经建好的成员不会跟着改名）`,
                  )
                : null,
            ),
            h(
              'div',
              { style: styles.field },
              h('span', { style: styles.label }, '描述'),
              h('input', { style: styles.input, value: description, onChange: editDraft('description', setDescription) }),
            ),
            h(
              'div',
              { style: styles.field },
              h('span', { style: styles.label }, '排序（越小越靠前）'),
              h('input', {
                style: styles.input,
                value: order,
                onChange: editDraft('order', setOrder),
              }),
            ),
            h(
              'div',
              { style: styles.row },
              h(
                'button',
                {
                  style: styles.button,
                  disabled: busy || idDraftInvalid || idDraftTaken,
                  onClick: async () => {
                    // id 变了就一起换（宿主半 §5.57：目录 + role.json +
                    // preset 注册名同步改），回包带新 id，这里跟着重新选中。
                    const payload = await run({
                      action: 'update-role',
                      id: selected.id,
                      name,
                      description,
                      order: Number(order) || 0,
                      ...(idDraftChanged ? { newId: selectedIdDraft } : null),
                    });
                    // §B1 — 保存成功 = 草稿已经落到服务端，解除 dirty 之后
                    // 后续的 /state 回包才允许重新填充表单。
                    if (payload) clearDirty();
                    if (payload && payload.id) setSelectedId(payload.id);
                  },
                },
                '保存角色信息',
              ),
              h(
                'button',
                {
                  style: styles.button,
                  disabled: busy,
                  title: describe(
                    'resetRole',
                    '把模式、能力行、MCP 开关都还原成刚建好这个角色时的样子（模式回到标准模式）；保留名字 / 描述 / 这个角色自己的 AGENTS.md',
                  ),
                  onClick: () => {
                    // §B1 — 还原会把服务端值重写一遍，草稿作废。
                    clearDirty();
                    return run({ action: 'reset-role', id: selected.id });
                  },
                },
                '全部还原（保留名字与 AGENTS.md）',
              ),
              h(
                'button',
                {
                  style: { ...styles.button, ...styles.danger },
                  disabled: busy,
                  title: describe('deleteRole', '连这个角色的目录一起删（role.json 与 AGENTS.md 都会没）'),
                  onClick: () => {
                    // §B1 — 角色都没了，草稿当然也作废。
                    clearDirty();
                    return run({ action: 'delete-role', id: selected.id });
                  },
                },
                '删除角色',
              ),
            ),
            // §5.32 — the base composition comes first: every other panel
            // below describes *this* role on top of one of the four modes.
            h(ModePanel, {
              role: selected,
              modes: state.modes,
              busy,
              onSet: (mode) => run({ action: 'set-mode', id: selected.id, mode }),
            }),
            // §5.29/§5.30/§5.31: the role is a directory, and one path says
            // everything — this panel shows it, and only it. The config and
            // rule files live inside it, so naming them separately here would be
            // three paths where one does (the user's m06726: 「我们的角色配置只需要
            // 显示一个路径就行，然后就直接去路径下编辑 agents.md 就行，
            //   保留一个还原键」). Its one restore key lives in this panel.
            //
            // Order is the user's (m05741): the directory first, then the
            // things you *tick* — and since m08302 the ticks are one block:
            // MCP 开关 is now a sub-part *inside* 能力行 (see GroupedTable's
            // children below), not a panel of its own.
            h(WorkdirPanel, {
              role: selected,
              workdir: state.workdir,
              busy,
              onReset: () => run({ action: 'reset-item', id: selected.id, item: 'agents-md' }),
            }),
            // R8: 「上下文是否继承主会话」 — an override on the row the template
            // already ships (`delegation/tool-subagent`, provider spawn↔fork).
            h(ContextPanel, {
              role: displayRole,
              busy: pending.has('context:tool-subagent'),
              onSet: onContextToggle,
            }),
            // §5.47 — 「技能也要能单独配置」(user m11777)。它跟在 MCP 那一块后面，作为
            // 能力行 的第二个子块（用户 m13289 2.「为啥不放到mcp下面？」；
            // MCP 和「技能」是同一层，不是缩进关系）。
            // §5.35 — the MCP list is handed to the table as children, so it
            // renders *inside* 能力行, right under the filter row (m08302
            // 「mcp放到搜索框下面去，作为能力行的子部分」).
            h(GroupedTable, {
              role: displayRole,
              platform: state.platform,
              busy,
              pending,
              onToggle,
              onBulk,
              onReset: () => run({ action: 'reset-item', id: selected.id, item: 'rows' }),
              // §5.55 — the summary line counts the three blocks below too (user
              // m18131「统计好像对技能/mcp没有生效」). The parent owns
              // `state.mcp` / `state.skills` / `state.toolGate`, so it does the
              // counting here — over the *same* entries the blocks render and
              // with the *same* filter rule, so the numbers cannot drift.
              extras: ({ needle, onlyChanged }) => {
                const entries = [
                  ...mcpEntries(displayRole, state.mcp),
                  ...skillEntries(displayRole, state.skills),
                  ...toolEntries(displayRole, state.toolGate),
                ];
                return {
                  total: entries.length,
                  shown: filterEntries(entries, needle, onlyChanged).length,
                  off: entries.filter((entry) => entry.off === true).length,
                  changed: entries.filter((entry) => entry.changed === true).length,
                };
              },
              panels: ({ needle, onlyChanged }) => [
                h(McpPanel, {
                  role: displayRole,
                  mcp: state.mcp,
                  pending,
                  onToggle: onMcpToggle,
                  onBulk: onMcpBulk,
                  needle,
                  onlyChanged,
                }),
                // §5.55 — 位置在 MCP 和技能中间（user m18131），名字叫「插件」（m18179）。
                h(PluginsPanel, {
                  role: displayRole,
                  toolGate: state.toolGate,
                  pending,
                  onToggle: onToolToggle,
                  onBulk: onToolBulk,
                  onGroup: onToolGroup,
                  needle,
                  onlyChanged,
                }),
                h(SkillsPanel, {
                  role: displayRole,
                  skills: state.skills,
                  // §5.49 — 逐行的「进行中」集合：勾一个技能
                  // 只灰它自己（MCP 那一块用的是同一套 `pending`）。
                  pending,
                  onSet: commitSkills,
                  needle,
                  onlyChanged,
                }),
              ],
            }),
          ),
    );
}

export { TeamRolesColumns };
