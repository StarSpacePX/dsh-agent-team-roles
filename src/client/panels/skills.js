// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 技能列表面板。

import { filterEntries, needleMatches, skillEntries } from './../entries.js';
import { describe, info, note, section } from './../notes.js';
import { React, h } from './../react.js';
import { styles } from './../styles.js';

function SkillsPanel({ role, skills, pending, onSet, needle = '', onlyChanged = false }) {
  // §5.36 — 默认折叠，跟 MCP 那一块一样。
  const [open, setOpen] = React.useState(false);
  const decision =
    role.skills || { mode: 'inherit', ids: [], dirs: [], missing: [], hasFilesystemRow: true, hasToolRow: true };
  const chosen = new Set(decision.ids || []);
  const pick = decision.mode === 'pick';
  const available = (skills && skills.available) || [];
  const missing = decision.missing || [];
  // §5.55 — the skill list obeys the ability column's filter box like every
  // other block. The `missing` names are a deliberate choice that points at
  // nothing on disk, so they only answer to the needle, not to 「只看改过的」.
  const availableShown = filterEntries(skillEntries(role, skills), needle, onlyChanged);
  const missingShown = missing.filter((name) => needleMatches(needle, name));
  const header = (text) =>
    h(
      'button',
      { style: styles.groupToggle, onClick: () => setOpen(!open), title: open ? '收起' : '展开' },
      open ? '▾' : '▸',
      ` ${text}`,
    );

  if (skills === undefined) {
    return h(
      'div',
      { style: styles.field },
      section(
        '技能',
        'skillsNoState',
        '宿主半还没重启，这次 /state 还没有 skills 段——重启 dsh 后这里才会列出技能。',
      ),
    );
  }

  const counting = pick ? `只挂勾选的 ${chosen.size} 个` : '继承这个模式的默认技能';
  const allChosen = available.length > 0 && available.every((skill) => chosen.has(skill.name));
  // §5.49 — 这一个技能自己的 round trip：点一个技能只灰它自己那一行，
  // 不会把 18 行 + 全选框一起变灰（user m13923）。
  const rowPending = (name) => pending !== undefined && pending.has(`skill:${name}`);
  const anyPending =
    pending !== undefined &&
    (pending.has('skill:mode') || available.some((skill) => pending.has(`skill:${skill.name}`)));
  const onFlip = (name, on) => {
    const next = new Set(chosen);
    if (on) next.add(name);
    else next.delete(name);
    onSet({ mode: 'pick', ids: [...next] }, [`skill:${name}`]);
  };
  // user m13289 1.「这里为啥没有全选？」—— 这一格现在和 MCP 那一行、各分组行
  // 一样是全选（半选 = 只勾了一部分）。「勾上就是用、不勾就是不加载」原样照办：
  // 全部不勾 = 这个角色一个技能都不加载；要回到「继承这个模式的默认技能」，
  // 用下面那颗还原按钮（那是模式，不是名单）。
  const onBulk = (on) => {
    const keys = available.map((skill) => `skill:${skill.name}`);
    return on
      ? onSet({ mode: 'pick', ids: available.map((skill) => skill.name) }, keys)
      : onSet({ mode: 'pick', ids: [] }, keys);
  };

  return h(
    'div',
    { style: styles.field },
    h(
      'div',
      { style: styles.panelHeader },
      h(
        'span',
        { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        header(`技能（${counting}）`),
        info(
          'skillsIntro',
          note(
            '勾上就是选用、取消就是不加载：勾选会把模式里已有的 skill-filesystem 行指向这些技能目录，原技能目录与预设文件都不动。',
            describe(
              'skillsHow',
              '继承（默认）= 跟以前一样，用这个模式自己的技能发现；只挂勾选的 = 用下面这份名单，没勾的不加载。',
            ),
            describe(
              'skillsGlobal',
              '全局层注册的技能（例如技能管理器自己提供的）对所有角色都可见，这一层筛不掉。',
            ),
          ),
        ),
      ),
      h(
        'span',
        { style: { textAlign: 'center' } },
        available.length === 0
          ? null
          : h('input', {
              type: 'checkbox',
              title: pick
                ? '全部勾上 / 全部不勾（不勾 = 一个技能都不加载；想回到「继承这个模式的默认技能」用下面那颗还原按钮）'
                : '全部勾上 = 变成「只挂勾选的」并把下面列出的都勾上',
              disabled: anyPending,
              checked: pick && allChosen,
              ref: (node) => {
                if (node !== null) {
                  node.indeterminate = pick && chosen.size > 0 && !allChosen;
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
          pick
            ? null
            : h(
                'div',
                { style: styles.hint },
                '这个角色跟随模式默认（不筛选）；在下面勾一个技能，它就会变成「只挂勾选的」。',
              ),
          decision.hasFilesystemRow === false
            ? h(
                'div',
                { style: styles.hint },
                '这个模式没有技能行；勾选技能会按需给它补上 skill-filesystem 与 tool-skill 两行（成对，缺一不可）。',
              )
            : null,
          skills.error ? h('div', { style: styles.error }, `技能目录读不全：${skills.error}`) : null,
          available.length === 0
            ? h('div', { style: styles.hint }, '这个部署的默认技能目录里没有技能（项目 .dsh/skills、~/.dsh/skills …）。')
            : availableShown.length === 0
              ? h(
                  'div',
                  { style: styles.hint },
                  '没有匹配的技能（清掉过滤框，或取消「只看被角色改过的行」）。',
                )
              : availableShown.map(({ item: skill }) =>
                h(
                  'div',
                  {
                    key: skill.name,
                    style: styles.child,
                    title: [skill.name, skill.description || '', skill.dir].filter((part) => part.length > 0).join(' — '),
                  },
                  h(
                    'span',
                    { style: styles.id },
                    skill.name,
                    h('span', { style: { opacity: 0.6 } }, ` · ${skill.rootLabel}`),
                  ),
                  h(
                    'span',
                    { style: { textAlign: 'center' } },
                    h('input', {
                      type: 'checkbox',
                      disabled: rowPending(skill.name),
                      checked: chosen.has(skill.name),
                      title: skill.description || skill.name,
                      onChange: (event) => onFlip(skill.name, event.target.checked),
                    }),
                  ),
                ),
              ),
          missingShown.map((name) =>
            h(
              'div',
              { key: `missing-${name}`, style: styles.child },
              h('span', { style: styles.error }, `${name}（这个部署里已经没了，装回来才会挂载）`),
              h(
                'span',
                { style: { textAlign: 'center' } },
                h('input', {
                  type: 'checkbox',
                  disabled: rowPending(name),
                  checked: true,
                  title: '取消勾选 = 从名单里去掉',
                  onChange: () => onFlip(name, false),
                }),
              ),
            ),
          ),
          h(
            'div',
            { style: styles.row },
            h(
              'button',
              {
                style: styles.button,
                disabled: anyPending,
                title: describe(
                  'skillsReset',
                  '把技能选择还原成「继承这个模式的默认技能」；已勾的名单会留着，方便再切回来。',
                ),
                onClick: () => onSet({ mode: 'inherit', ids: [...decision.ids] }, ['skill:mode']),
              },
              '还原技能选择',
            ),
          ),
        ),
  );
}

/**
 * R2.3 — the MCP switch list.
 *
 * One row per MCP server *of this deployment*, read live from the
 * connector's own storage by the host half. A row here is not a new
 * connection: unchecking a server records the server name in the role's
 * `mcp.deny`, and the gateway row that carries that list mounts inside the
 * role and hides those tools for this agent only. The connector keeps
 * running, every other agent keeps seeing the server, and nothing is
 * disconnected — which is also why the switch is safe to flip while dsh is
 * live.
 */

export { SkillsPanel };
