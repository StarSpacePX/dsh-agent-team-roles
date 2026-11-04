// 客户端真源码（lib/client.js 是构建产物，勿手改）。
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
// 默认全部折叠：记的是**展开过的**分类集合，所以不用先知道这个角色有哪些分类 —— 没人打开过就折叠。
  const [expanded, setExpanded] = React.useState(() => new Set());
// 「全开 / 全关」进行中不再整表变灰、也不再一行行跳：目标状态由父层的乐观覆盖（draft）
// 立刻画出来，所以这里读的就是那个算好的 role（父层传进来的是 displayRole）。
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
// 旧版宿主还用自己那套 identity 维度给 persona 打标签：要归一化，
// CATEGORY_ORDER 里没有的分类会把整行丢掉。
      const raw = row.category === 'identity' ? 'agents-md' : row.category;
      const key = CATEGORY_LABEL[raw] === undefined ? 'other' : raw;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return CATEGORY_ORDER.filter((key) => map.has(key)).map((key) => [key, map.get(key)]);
  }, [visible]);

// 分类标题后的数字数的是这一类整体的行数，不是过滤后的
// 不过滤写总数，被过滤掉一部分时写「显示 3 / 共 19」。
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
// 汇总覆盖整个能力列：下面的 MCP / 技能 / 插件 块也是开关。
// 父层持有它们的条目，于是交回同一份 needle / onlyChanged 的计数。
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
// 位置：能力行标题 → 还原默认 → 搜索框行 → MCP → 表头 → 各分组。
// MCP 与「技能」这些分组是同一层，不缩进、不加左边线，标题与行都对齐。
// 它作为 children 由调用方传入（GroupedTable 只负责位置）。
// 说明文字与宿主 DEFAULT_NOTES.rows 逐字一致（多行，行首不留缩进）。
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
// 渲染属性而不是固定数组：里面的 MCP / 技能 / 插件 块必须看到过滤框里的 needle，
// 而只有这里持有它。（不能当函数 children 用 —— React 里函数 child 是非法的。）
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
// 这个复选框就是「全开 / 全关」（半选 = 一部分开着）：同一个动作只有一个入口。
              title: '整类开关（全开 / 全关）',
// 只有被点的这个复选框自己进入进行中（全局 busy 会把整张表 + 工具栏一起变灰）。
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
// 二级行 = 范式里的 child（缩进一级），文字与上面分类标题起在同一条竖线上。
// 这里不按 row.parent 再分层：那张表按 row.path 平铺、按类别分组，父亲行在「分组」那一类里
// 看不见，缩进什么都说明不了；层级信息 row.path 本身已经写全了。
                ...styles.child,
                ...(row.hasOverride ? styles.lineOverride : null),
              },
            },
            h(
              'span',
              {
                style: styles.id,
// 只显示行名。行的配置是插件作者的事，好奇的人看悬浮提示即可；
// 这份列表只回答一个问题：这是哪个开关。
                title: [
                  row.name || '',
                  row.path,
                  row.config === null || row.group ? '' : JSON.stringify(row.config),
                ]
                  .filter((part) => part.length > 0)
                  .join(' — '),
              },
              row.path,
// 分组可以声明 isolate：它的某些服务待在独立 realm 里，而不是与部署共享。
// 它不影响行是否启用，所以画成标记而不是开关；但在这组里切行的人该知道这组装配方式不同。
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
// 只有这一行自己的请求会让它变灰。
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

// 一个角色正好一个目录，规则文件就是目录里的 AGENTS.md，宿主侧已经接好了，这里没什么可选。
// 发现键仍可经 HTTP（agent-instructions 行的 set-override）手改，界面不再给第二处入口。

export { GroupedTable };
