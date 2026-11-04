// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// MCP 面板。

import { filterEntries, mcpEntries } from './../entries.js';
import { info, section } from './../notes.js';
import { React, h } from './../react.js';
import { styles } from './../styles.js';

function McpPanel({ role, mcp, pending, onToggle, onBulk, needle = '', onlyChanged = false }) {
  // §5.36 — user m08545 2.「默认都折叠起来」: the MCP list starts folded too.
  const [open, setOpen] = React.useState(false);
  const capabilities = role.capabilities || {};
  const deny = new Set((capabilities.mcp || {}).deny || []);
  const services = (mcp && mcp.services) || [];
  const header = (text) =>
    h(
      'button',
      // 不叠加 `styles.sectionTitle`（13px/700）：MCP 这一行和分组行
      // 同级，字号/字重也跟着一样（`groupToggle` 的 600，字号继承 root 的 13px）。
      { style: styles.groupToggle, onClick: () => setOpen(!open), title: open ? '收起' : '展开' },
      open ? '▾' : '▸',
      ` ${text}`,
    );

  // An older host half does not send `mcp` at all. Say so, instead of
  // rendering "the connector has no connections" — which would be a lie.
  if (mcp === undefined) {
    return h(
      'div',
      { style: styles.field },
      section(
        'MCP 开关',
        'mcpNoState',
        '宿主半还没重启，这次 /state 还没有 mcp 段——重启 dsh 后这里才会列出连接器里的 server。',
      ),
    )
  }

  if (mcp.error) {
    return h(
      'div',
      { style: styles.field },
      section('MCP 开关'),
      h('div', { style: styles.error }, `读不到连接器的存储文件：${mcp.error}`),
    );
  }

  // MCP 这一行也要有一个「整行开关」，和各分组标题行长得一样：
  // 它就是全开 / 全关（半选 = 只开了一部分）。
  const allow = services.filter((service) => !deny.has(service.serverName));
  // §5.55 — the same needle / only-changed rule as every other block.
  const entries = filterEntries(mcpEntries(role, mcp), needle, onlyChanged);

  return h(
    'div',
    { style: styles.field },
    h(
      'div',
      // 和分组行用同一套 `styles.panelHeader`（灰底 + 同样的两列网格），
      // 不是 `styles.sectionHeader`（只有一条下划线、没有底色）——
      // 这样灰底层级才和下面的分组行一致（用户问「为啥 mcp 这一行不是和下面的一样是灰色」）。
      { style: styles.panelHeader },
      h(
        'span',
        { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        header(`MCP 开关（部署里有 ${services.length} 个 server）`),
        info(
          'mcpIntro',
          '取消勾选只是让这个角色看不见该 server 的工具（mcp__<名字>__*），连接器与其它角色都不受影响。',
        ),
      ),
      h(
        'span',
        { style: { textAlign: 'center' } },
        services.length === 0
          ? null
          : h('input', {
              type: 'checkbox',
              // 和分组行同一个入口：复选框 = 全开 / 全关。
              title: '全部 server 一起开 / 关（半选 = 只开了一部分）',
              disabled: pending.has('mcp:*'),
              checked: allow.length === services.length,
              ref: (node) => {
                if (node !== null) {
                  node.indeterminate = allow.length > 0 && allow.length < services.length;
                }
              },
              onChange: (event) => onBulk(event.target.checked),
            }),
      ),
    ),
    open === false
      ? null
      : h(
          'div',
          { style: styles.table },
          services.length === 0
            ? h('div', { style: styles.hint }, '连接器里还没有任何 MCP 连接。')
            : entries.length === 0
              ? h(
                  'div',
                  { style: styles.hint },
                  '没有匹配的 server（清掉过滤框，或取消「只看被角色改过的行」）。',
                )
              : entries.map(({ item: service }) =>
                h(
                  'div',
                  {
                    key: service.serverName,
                    style: styles.child,
                    title: [
                      service.serverName,
                      service.label || '',
                      `连接器：${service.enabled ? '已启用' : '已停用'}`,
                      service.target ? `目标：${service.target}` : '',
                    ]
                      .filter((part) => part.length > 0)
                      .join(' — '),
                  },
                  h(
                    'span',
                    { style: styles.id },
                    service.serverName,
                    service.enabled
                      ? null
                      : h('span', { style: styles.badge }, '连接器里已停用'),
                  ),
                  h('span', { style: { textAlign: 'center' } }, h('input', {
                    type: 'checkbox',
                    // §5.35 — per-server pending only (m08302).
                    disabled: pending.has(`mcp:${service.serverName}`),
                    checked: !deny.has(service.serverName),
                    title: deny.has(service.serverName)
                      ? '这个角色看不见该 server 的工具'
                      : '跟随部署（该角色能看见该 server 的工具）',
                    onChange: (event) => onToggle(service.serverName, event.target.checked),
                  })),
                ),
              ),
        ),
  );
}

/**
 * §5.55 — user m18131「角色可见性禁用就行，你加一下，在 mcp 和技能中间」.
 *
 * The list of tools the deployment registered globally (`ego_*`,
 * `list_agents`, …), each one a **per-role visibility** switch. It is not the
 * same thing as the 「工具 (19)」 group above: a preset row switched off is a
 * plugin that is not mounted at all, while a box switched off here leaves the
 * plugin running and hides one tool from this role and its descendants.
 *
 * That is why the rows carry **exact tool names**: `tools.schemas()` reports
 * a name, a description and a parameter schema — and no field saying which
 * plugin registered a tool — so there is no honest way to group them by
 * plugin. One flat list, obeying the ability column's filter box.
 *
 * The name is recorded in `capabilities.toolGate.deny`; the
 * `agent-team-tool-gate` row mounts inside the role and calls
 * `tools.restrict({ deny })` against the live registry (a name nothing
 * registers is dropped there rather than failing the mount).
 *
 * Two kinds are deliberately absent: the MCP tools — the block above owns
 * them, by server, via their `mcp__<server>__` prefix — and `run_code`, which
 * the registry refuses to restrict at all.
 */

export { McpPanel };
