// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 插件 / 工具门面板。

import { filterEntries, groupTools, toolEntries } from './../entries.js';
import { describe, info, section } from './../notes.js';
import { React, h } from './../react.js';
import { styles } from './../styles.js';

function PluginsPanel({
  role,
  toolGate,
  pending,
  onToggle,
  onBulk,
  onGroup,
  needle = '',
  onlyChanged = false,
}) {
  // §5.36 — 默认折叠，和 MCP / 技能两块一样。
  const [open, setOpen] = React.useState(false);
  // §5.55 — 组也默认收起（67 个工具平铺出来就是这么来的），搜索时自动把匹配到的组摊开。
  const [unfolded, setUnfolded] = React.useState(() => new Set());
  const capabilities = role.capabilities || {};
  const deny = new Set(((capabilities.toolGate || {}).deny) || []);
  const tools = (toolGate && toolGate.tools) || [];
  const header = (text) =>
    h(
      'button',
      { style: styles.groupToggle, onClick: () => setOpen(!open), title: open ? '收起' : '展开' },
      open ? '▾' : '▸',
      ` ${text}`,
    );

  if (toolGate === undefined) {
    return h(
      'div',
      { style: styles.field },
      section(
        '插件',
        'toolGateNoState',
        '宿主半还没重启，这次 /state 还没有 toolGate 段——重启 dsh 后这里才会列出部署全局注册的工具。',
      ),
    );
  }

  // §5.55 — same filter rule as every other block, from the same entries.
  const entries = filterEntries(toolEntries(role, toolGate), needle, onlyChanged);
  const keep = new Set(entries.map((entry) => entry.key));
  const layout = groupTools(toolEntries(role, toolGate));
  const groups = layout.groups
    .map((group) => ({
      key: group.key,
      members: group.members,
      shown: group.members.filter((entry) => keep.has(entry.key)),
    }))
    .filter((group) => group.shown.length > 0);
  const loose = layout.loose.filter((entry) => keep.has(entry.key));
  const allow = tools.filter((tool) => !deny.has(tool.name));

  const foldGroup = (key) => {
    setUnfolded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toolRow = ({ item: tool }) =>
    h(
      'div',
      {
        key: `tool:${tool.name}`,
        style: styles.child,
        title: [tool.name, tool.description || '']
          .filter((part) => part.length > 0)
          .join(' — '),
      },
      h('span', { style: styles.id }, tool.name),
      h(
        'span',
        { style: { textAlign: 'center' } },
        h('input', {
          type: 'checkbox',
          disabled: pending.has(`tool:${tool.name}`),
          checked: !deny.has(tool.name),
          title: deny.has(tool.name)
            ? '这个角色看不见这个工具'
            : '跟随部署（该角色能看见这个工具）',
          onChange: (event) => onToggle(tool.name, event.target.checked),
        }),
      ),
    );

  // §5.55 — 组头那一行：一条标题 + 一个「整组一起开 / 关」的勾选框（半选 = 组里只关了
  // 一部分）。点它写的还是逐个精确工具名，所以整组一次落盘、一次重建。
  const groupRow = (group) => {
    const total = group.members.length;
    const off = group.members.filter((entry) => entry.off).length;
    const expanded = needle.length > 0 || onlyChanged || unfolded.has(group.key);
    const key = `toolgroup:${group.key}`;
    return [
      h(
        'div',
        {
          key: `group:${group.key}`,
          style: styles.lineStrong,
          title: `按名字前缀分组：${group.key}_*（${total} 个）`,
        },
        h(
          'span',
          { style: styles.id },
          h(
            'button',
            {
              style: styles.groupToggle,
              onClick: () => foldGroup(group.key),
              title: expanded ? '收起这一组' : '展开这一组',
            },
            expanded ? '▾' : '▸',
            ` ${group.key}（${total} 个${off > 0 ? ` · 已关 ${off}` : ''}）`,
          ),
        ),
        h(
          'span',
          { style: { textAlign: 'center' } },
          h('input', {
            type: 'checkbox',
            disabled: pending.has(key),
            checked: off === 0,
            title: off === 0 ? '整组都关掉' : '整组都打开',
            ref: (node) => {
              if (node !== null) node.indeterminate = off > 0 && off < total;
            },
            onChange: (event) =>
              onGroup(
                group.key,
                group.members.map((entry) => entry.item.name),
                event.target.checked,
              ),
          }),
        ),
      ),
      ...(expanded ? group.shown.map(toolRow) : []),
    ];
  };

  const body = [];
  for (const group of groups) body.push(...groupRow(group));
  for (const entry of loose) body.push(toolRow(entry));

  return h(
    'div',
    { style: styles.field },
    h(
      'div',
      { style: styles.panelHeader },
      h(
        'span',
        { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        header(`插件（部署里有 ${tools.length} 个可禁用的工具）`),
        info(
          'toolGateIntro',
          '取消勾选 = 这个角色（以及它派生的成员）看不见这个工具：插件仍在运行，别的角色照旧。',
          describe(
            'toolGateVsRows',
            '和上面「工具」分组不是一回事：那一组是模式模板行，关掉等于**不挂载**整个插件；这里关掉的只是这个角色的可见性。',
          ),
          describe(
            'toolGateGroups',
            '名字前缀相同、且数量 ≥3 的自动归成一组（组头那个勾选框 = 整组一起开 / 关），其余平铺在外面。工具清单里没有「属于哪个插件」这个字段，所以只能按名字前缀分组。',
          ),
          describe(
            'toolGateScope',
            'MCP 的工具由上面的 MCP 开关按 server 整片管；run_code 注册表不允许遮蔽。这两类都不在下面这份名单里。',
          ),
        ),
      ),
      h(
        'span',
        { style: { textAlign: 'center' } },
        tools.length === 0
          ? null
          : h('input', {
              type: 'checkbox',
              title: '全部工具一起开 / 关（半选 = 只开了一部分）',
              disabled: pending.has('tool:*'),
              checked: allow.length === tools.length,
              ref: (node) => {
                if (node !== null) {
                  node.indeterminate = allow.length > 0 && allow.length < tools.length;
                }
              },
              onChange: (event) => onBulk(event.target.checked),
            }),
      ),
    ),
    toolGate.error
      ? h('div', { style: styles.error }, `读不到工具清单：${toolGate.error}`)
      : null,
    open === false
      ? null
      : h(
          'div',
          { style: styles.table },
          tools.length === 0
            ? h('div', { style: styles.hint }, '这个部署的全局层没有可禁用的工具。')
            : body.length === 0
              ? h(
                  'div',
                  { style: styles.hint },
                  '没有匹配的工具（清掉过滤框，或取消「只看被角色改过的行」）。',
                )
              : body,
        ),
  );
}

/**
 * R2.4 / R2.5 — the role's working directory: **one path, one restore key**.
 *
 * There is no loop path selector and no 「复制标准模式」 button here, and
 * neither could work: `agent-loop` cannot live inside a preset at all (it
 * owns the single agent-factory slot, so mounting one fails the whole
 * preset), and even if it could, the directory a task runs in is fixed when
 * the task is created — a preset has no `cwd` field to set.
 *
 * Nor is there an AGENTS.md selector (§5.31, user m07109):
 * the role owns one directory, its rules file is that directory's
 * `AGENTS.md`, and the host half already wires the role to it. So the panel
 * shows the path — to go and edit that file — and keeps exactly one restore
 * key, which re-copies the file from the main session and clears this role's
 * `agent-instructions` overrides in one move.
 */

export { PluginsPanel };
