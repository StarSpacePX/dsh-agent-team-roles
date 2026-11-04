// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// MCP 面板。

import { filterEntries, mcpEntries } from './../entries.js';
import { info, section } from './../notes.js';
import { React, h } from './../react.js';
import { styles } from './../styles.js';

function McpPanel({ role, mcp, pending, onToggle, onBulk, needle = '', onlyChanged = false }) {
// MCP 列表默认折叠，与技能那一块一致。
  const [open, setOpen] = React.useState(false);
  const capabilities = role.capabilities || {};
  const deny = new Set((capabilities.mcp || {}).deny || []);
  const services = (mcp && mcp.services) || [];
  const header = (text) =>
    h(
      'button',
// 不叠加 styles.sectionTitle（13px/700）：MCP 这一行与分组行同级，字号字重保持一致（600，字号继承 13px）。
      { style: styles.groupToggle, onClick: () => setOpen(!open), title: open ? '收起' : '展开' },
      open ? '▾' : '▸',
      ` ${text}`,
    );

// 旧版宿主根本不发 mcp：要明说，而不是渲染成「连接器没有连接」—— 那是假话。
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

// MCP 这一行也要有一个整行开关，和各分组标题行长得一样：它就是全开 / 全关（半选 = 只开了一部分）。
  const allow = services.filter((service) => !deny.has(service.serverName));
// 与其它块同一条 needle / 只看改过的规则。
  const entries = filterEntries(mcpEntries(role, mcp), needle, onlyChanged);

  return h(
    'div',
    { style: styles.field },
    h(
      'div',
// 和分组行用同一套 styles.panelHeader（灰底 + 两列网格），
// 不是 styles.sectionHeader（只有下划线、没底色），这样灰底层级才和下面的分组行一致。
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
// 逐 server 的 pending。
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

/** 部署全局注册的工具名单（ego_*、list_agents…），每个都是一个**按角色**的可见性开关。
 * 和上面「工具 (19)」那一组不是一回事：那是整个插件没挂载；
 * 这里插件照跑，只是对这个角色藏掉具体工具。 */

export { McpPanel };
