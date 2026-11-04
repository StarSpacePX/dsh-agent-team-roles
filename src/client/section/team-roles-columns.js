// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 角色列表 + 详情列，JSX 整段保留。

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
// 副标题只留「英文名(中文名)」：英文名 = 角色 id 去掉 team- 前缀（即成员名），
// 中文名 = role.name；模式在下面单独配置，不再挤这一行。没中文名时不写空括号。
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
// 换角色：上一个角色的草稿作废（不保存），新角色按服务端值填充；
// 必须一次提交做完（见 selectRole），否则会闪一帧红字把内容顶开。
                    selectRole(role.id);
                  },
                },
                roleLabel,
// registered 含「已登记但还没挂载」的角色，不是错误
// 改动已存进 JSON，等这个角色真被用到（创建成员或被选为会话预设）时才构建挂载。
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
// 走 editDraft：一改就记 dirty，之后任何 /state 回包都不覆盖这份草稿。
              h('input', { style: styles.input, value: name, onChange: editDraft('name', setName) }),
            ),
// 角色 id 决定成员名（去掉 team- 前缀），改它等于把目录、role.json、
// 已注册的 preset 一起换名；已建好的成员不会跟着改名。
            h(
              'div',
              { style: styles.field },
              h(
                'span',
                { style: { ...styles.label, ...styles.labelInline } },
                '角色 ID（成员名）',
// 常态说明收进标题旁的 ⓘ（文案键 roleMemberName，与宿主 DEFAULT_NOTES 逐字一致）。
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
// id 变了就一起换（宿主侧：目录 + role.json + preset 注册名同步改），
// 回包带新 id，这里跟着重新选中。
                    const payload = await run({
                      action: 'update-role',
                      id: selected.id,
                      name,
                      description,
                      order: Number(order) || 0,
                      ...(idDraftChanged ? { newId: selectedIdDraft } : null),
                    });
// 保存成功 = 草稿已落到服务端；解除 dirty 之后 /state 回包才允许重新填表单。
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
// 还原会把服务端值重写一遍，草稿作废。
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
// 角色都没了，草稿当然也作废。
                    clearDirty();
                    return run({ action: 'delete-role', id: selected.id });
                  },
                },
                '删除角色',
              ),
            ),
// 基础构成排在最前：下面每个面板都在四种模式之一上描述这个角色。
            h(ModePanel, {
              role: selected,
              modes: state.modes,
              busy,
              onSet: (mode) => run({ action: 'set-mode', id: selected.id, mode }),
            }),
// 角色就是一个目录，一个路径说明一切：配置与规则文件都在里面（AGENTS.md 直接去路径下改）。
// 这里只显示这一个路径，还原键也在这块。
            h(WorkdirPanel, {
              role: selected,
              workdir: state.workdir,
              busy,
              onReset: () => run({ action: 'reset-item', id: selected.id, item: 'agents-md' }),
            }),
// 是否继承主会话上下文：覆盖模板自带的那一行（delegation/tool-subagent，provider 在 spawn↔fork）。
            h(ContextPanel, {
              role: displayRole,
              busy: pending.has('context:tool-subagent'),
              onSet: onContextToggle,
            }),
// 技能跟在 MCP 后面，同属能力行的子块（两者同一层，不缩进）。
// MCP 列表作为 children 传进表格，渲染在能力行里、过滤行下面。
            h(GroupedTable, {
              role: displayRole,
              platform: state.platform,
              busy,
              pending,
              onToggle,
              onBulk,
              onReset: () => run({ action: 'reset-item', id: selected.id, item: 'rows' }),
// 汇总行也统计下面三块：父组件持有 state.mcp / skills / toolGate，
// 于是按与子块相同的条目和过滤规则在这里数，数字不会漂。
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
// 位置在 MCP 与技能之间，名字叫「插件」。
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
// 逐行的「进行中」集合：勾一个技能只灰它自己（MCP 那一套用同一个 pending）。
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
