// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 分组表格（能力表通用表体）。

import { CATEGORY_LABEL, CATEGORY_ORDER } from './../constants.js';
import { needleMatches } from './../entries.js';
import { describe, section } from './../notes.js';
import { React, h } from './../react.js';
import { styles } from './../styles.js';

function GroupedTable({
  role,
  platform,
  busy,
  pending,
  onToggle,
  onBulk,
  onReset,
  extras,
  panels,
  children,
}) {
  const [query, setQuery] = React.useState('');
  const [onlyChanged, setOnlyChanged] = React.useState(false);
  // §5.36 — user m08545 2.「默认都折叠起来」. Kept as a set of **expanded**
  // categories (not collapsed ones) so the default is "everything folded"
  // without having to know which categories the role has up front: a
  // category nobody has opened is collapsed, whatever it is.
  const [expanded, setExpanded] = React.useState(() => new Set());
  // 「全开 / 全关」进行中不再整表变灰、也不再一行一行地跳：目标
  // 状态由父层的乐观覆盖（`draft`）立刻画出来，所以这里读的就是那个已经算好的
  // role（父层传进来的是 `displayRole`）。
  const effective = (row) => row.disabled !== true;

  const fold = (category) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return role.rows.filter((row) => {
      if (onlyChanged && row.hasOverride !== true) return false;
      return needleMatches(needle, `${row.path} ${row.name || ''}`);
    });
  }, [role.rows, query, onlyChanged]);

  const grouped = React.useMemo(() => {
    const map = new Map();
    for (const row of visible) {
      // A host half that predates the merge still labels `persona` with its
      // own `identity` dimension. Normalise instead of trusting the label:
      // a category missing from CATEGORY_ORDER would drop the row entirely.
      const raw = row.category === 'identity' ? 'agents-md' : row.category;
      const key = CATEGORY_LABEL[raw] === undefined ? 'other' : raw;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return CATEGORY_ORDER.filter((key) => map.has(key)).map((key) => [key, map.get(key)]);
  }, [visible]);

  // 分类标题后面的那个数字：它数的是**这一类整体的行数**，不是过滤后的行数 ——
  // 否则同一个分类在过滤时显示（3）、不过滤时显示（19），没人知道它在数什么。
  // 不过滤就写总数，被过滤掉一部分时写成「显示 3 / 共 19」。
  const totals = React.useMemo(() => {
    const map = new Map();
    for (const row of role.rows) {
      const raw = row.category === 'identity' ? 'agents-md' : row.category;
      const key = CATEGORY_LABEL[raw] === undefined ? 'other' : raw;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [role.rows]);

  if (role.invalid === true) {
    return h('div', { style: styles.error }, '这个角色条目在文件里已损坏，无法展开。');
  }

  const offCount = role.rows.filter((row) => row.disabled === true).length;
  const changedCount = role.rows.filter((row) => row.hasOverride === true).length;
  // §5.55 — the summary covers the whole ability column: the MCP / 技能 / 插件
  // blocks below are switches too. The parent owns their entries (it has
  // `state.mcp` / `state.skills` / `state.toolGate`), so it hands back the
  // counts for the very same `needle` / `onlyChanged` this panel is using.
  const extra =
    typeof extras === 'function'
      ? extras({ needle: query.trim().toLowerCase(), onlyChanged })
      : { total: 0, shown: 0, off: 0, changed: 0 };
  const summary = {
    total: role.rows.length + extra.total,
    shown: visible.length + extra.shown,
    off: offCount + extra.off,
    changed: changedCount + extra.changed,
  };
  const modeTitle = role.modeLabel || role.mode || 'standard';

  return h(
    'div',
    { style: styles.table },
    // §5.35 — 位置按用户 m08302 的指定：能力行标题 → 还原默认 → 搜索框行 →
    // MCP → 表头 → 各分组。m08489 补一句层级：MCP 和「技能」这些分组是**同一层**，
    // 不是缩进在它们下面的子层级 ⇒ 容器不缩进、不加左边线，标题与行都和各分组对齐。
    // 它由调用方作为 children 传进来（`GroupedTable` 只负责位置）。
    // 说明文字与宿主 `lib/notes.js` 的 DEFAULT_NOTES.rows 逐字一致（多行，行首不留缩进）。
    section(
      '能力行',
      'rows',
      `这一列的行整体来自部署的 {mode} 模式模板（插件在构建时抽的快照，运行时只引用它）。
每一行右边的勾选开关是「这个角色是否启用这一行」；改过的行左侧会有一条竖线。
分组行（例如 persistent-shell）可以整组开关；组声明了 isolate 时那一行会标出来 —— 它只影响服务落在哪个 realm，不影响开关。
平台门控已按 {platform} 解析。勾选框显示的是勾选即启用；左侧竖线表示该行被角色覆盖过。
表里就是这个角色当前模式（见上面「模式」）的全部行；MCP 开关在角色详情里单独列出，因为四个模式里都没有这类行，它由连接器的连接生成。`,
      { mode: modeTitle },
    ),
    h(
      'div',
      { style: styles.row },
      h(
        'button',
        {
          style: styles.button,
          disabled: busy,
          title: describe(
            'rowsReset',
            '把所有行的开关与覆盖还原成 {mode} 模式模板的样子（MCP 开关与插件名单也一起清掉）',
            { mode: modeTitle },
          ),
          onClick: () => onReset(),
        },
        '还原默认',
      ),
    ),
    h(
      'div',
      { style: styles.row },
      h('input', {
        style: styles.inputGrow,
        placeholder: '过滤：包名 / 行 id / 行名 / MCP server / 技能 / 插件',
        value: query,
        onChange: (event) => setQuery(event.target.value),
      }),
      h(
        'label',
        { style: { ...styles.hint, display: 'flex', gap: 6, alignItems: 'center' } },
        h('input', {
          type: 'checkbox',
          checked: onlyChanged,
          onChange: (event) => setOnlyChanged(event.target.checked),
        }),
        '只看被角色改过的行',
      ),
      h(
        'span',
        { style: styles.hint },
        `共 ${summary.total} 行 · 显示 ${summary.shown} · 已关 ${summary.off} · 被覆盖 ${summary.changed}`,
      ),
    ),
    // §5.55 — a render prop, not a fixed array: the MCP / 技能 / 插件 blocks
    // inside must see the same needle the filter box holds, and only this
    // component owns it. (Not `children` as a function — this is React, where
    // a function child is invalid.)
    typeof panels === 'function'
      ? panels({ needle: query.trim().toLowerCase(), onlyChanged })
      : children,
    grouped.map(([category, rows]) =>
      h(
        'div',
        { key: category },
        h(
          'div',
          { style: styles.lineGroup },
          h(
            'button',
            {
              style: styles.groupToggle,
              onClick: () => fold(category),
              title: expanded.has(category) ? '收起这一类' : '展开这一类',
            },
            expanded.has(category) ? '▾' : '▸',
            ` ${CATEGORY_LABEL[category] || category}`,
            h(
              'span',
              { style: styles.badge },
              rows.length === totals.get(category)
                ? `（${rows.length}）`
                : `（显示 ${rows.length} / 共 ${totals.get(category) || 0}）`
            ),
          ),
          h(
            'span',
            { style: { textAlign: 'center' } },
            h('input', {
              type: 'checkbox',
              // 这一个复选框就是「全开 / 全关」（半选 = 一部分开着）：
              // 同一个动作只有一个入口。
              title: '整类开关（全开 / 全关）',
              // 只有被点的这一个复选框自己进入「进行中」（全局
              // `busy` 会把整张表 + 工具栏一起变灰）。
              disabled: pending.has(`group:${category}`),
              checked: rows.every((row) => effective(row)),
              ref: (node) => {
                if (node !== null) {
                  const on = rows.filter((row) => effective(row)).length;
                  node.indeterminate = on > 0 && on < rows.length;
                }
              },
              onChange: (event) => onBulk(rows, event.target.checked, category),
            }),
          ),
        ),
        expanded.has(category)
          ? rows.map((row) =>
          h(
            React.Fragment,
            { key: row.path },
            h(
            'div',
            {
              style: {
                // 二级行 = 范式里的 `child`（缩进一级），跟上面那个分类标题
                // （`▸ 身份与规则（2）`）的**文字**起在同一条竖线上（用户 m11942）。
                // 注意这里**不按** `row.parent` 再分一层：「工具」这一类里凡是某个分组的成员
                // （`delegation/tool-subagent`、`compaction/tool-result-pruner`）都比
                // 同级行右移，而那张表是按 `row.path` 平铺、按类别分组的：行的父亲
                // （那个分组行）在「分组」那一类里，看不到，所以那点缩进什么都说明不了，
                // 只显得没对齐。层级信息 `row.path` 本身（`delegation/…`）已经写全了，
                // 同一类里每一行都从同一列起排。
                ...styles.child,
                ...(row.hasOverride ? styles.lineOverride : null),
              },
            },
            h(
              'span',
              {
                style: styles.id,
                // Only the row's own name is shown. The row's config is the
                // plugin author's business, and the tooltip is where a reader
                // who is curious can still see it — the list itself answers
                // one question: "which switch is this".
                title: [
                  row.name || '',
                  row.path,
                  row.config === null || row.group ? '' : JSON.stringify(row.config),
                ]
                  .filter((part) => part.length > 0)
                  .join(' — '),
              },
              row.path,
              // A group may declare `isolate`: which of its services live in a
              // realm of their own instead of being shared with the deployment.
              // It never changes whether a row is enabled, so it is shown as a
              // marker rather than a switch — but a reader toggling rows in this
              // group deserves to know the group is not assembled like the rest.
              row.isolate && typeof row.isolate === 'object' && Object.keys(row.isolate).length > 0
                ? h(
                    'span',
                    {
                      style: styles.badge,
                      title:
                        `这个组声明的服务隔离：${Object.keys(row.isolate).join('、')}。` +
                        'true = 该实现在本组自己的 realm 里，具名值 = 按同名 label 共享的 realm；' +
                        '隔离不改变行是否启用，只决定服务实例被谁看见。',
                    },
                    `隔离 ${Object.keys(row.isolate).join('/')}`,
                  )
                : null,
            ),
            h('span', { style: { textAlign: 'center' } }, h('input', {
              type: 'checkbox',
              // §5.35 — only *this* row's own request greys it (m08302).
              disabled: pending.has(`row:${row.id}`),
              checked: effective(row),
              title:
                row.templateDisabled !== row.disabled
                  ? '已被角色覆盖'
                  : '跟随模板（当前平台）',
              onChange: (event) => onToggle(row, event.target.checked),
            })),
            ),
          ),
        ) : null,
      ),
    ),
  );
}

// §5.31 — a role owns exactly one directory, its rules file is that directory's
// `AGENTS.md`, and the host half already wires the role to it — so there is
// nothing to pick here (user m07109: 「我们的角色配置只需要显示一个路径就行，
//   然后就直接去路径下编辑 agents.md 就行，保留一个还原键」). The discovery keys
// stay reachable over HTTP
// (`set-override` on the `agent-instructions` row) for hand edits, but the
// UI shows the one path and the one restore key (in 角色工作目录 below).
/**
 * R8 — 「上下文是否继承主会话」 (user m07109; 「用现成的方式实现就行」 m07236).
 *
 * The standard preset's `delegation` group already ships two ways to
 * delegate, and they differ in exactly this: `tool-subagent` runs on the
 * `spawn` provider (the child is a fresh Agent with zero parent context) and
 * `tool-subagent-fork` runs on `fork` (the child is seeded with the parent's
 * completed-turn prefix). So "does the delegated child inherit?" is already a
 * *config value of a row the template ships* — `provider` — and this switch
 * only moves that one key. No row is added, and nothing outside this role's
 * own `role.json` is touched.
 *
 * The tool name deliberately stays `subagent`, so the model keeps seeing one
 * delegation tool either way; only the transport behind it changes.
 */

export { GroupedTable };
