// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 模式面板。

import { describe, note, section } from './../notes.js';
import { h } from './../react.js';
import { styles } from './../styles.js';

function ModePanel({ role, modes, busy, onSet }) {
  const list = Array.isArray(modes) && modes.length > 0 ? modes : null;
  // 用户 m07126/m07129：**默认选中「这条角色实际挂的预设」**（= 它自己那份复制品，
  // `/state` 里叫 `role.presetId`），不是模板（`role.mode`）。只显示模板会让「看到 user、
  // 实际挂的是复制品」这件事变成骗人的显示。
  const actual = typeof role.presetId === 'string' && role.presetId !== '' ? role.presetId : '';
  const listed = list !== null && actual !== '' && list.some((mode) => mode.id === actual);
  const current = listed ? actual : role.mode || 'standard';
  const known = list === null ? [] : list.map((mode) => mode.id);
  // The role's own mode is always an option, even if the roster no longer
  // offers it (the preset was deleted): a stored role must remain readable,
  // and the value must not silently jump to another mode just by opening
  // the panel.
  const options =
    list === null || known.includes(current)
      ? list
      : [{ id: current, label: role.modeLabel || current, available: role.modeAvailable !== false }, ...list];
  const chosen = options === null ? null : options.find((mode) => mode.id === current);

  if (list === null) {
    return h(
      'div',
      { style: styles.field },
      section(
        '模式',
        'modeNoState',
        '宿主半还没重启，这次 /state 里还没有 modes 段。',
      ),
    );
  }

  const describeMode = (mode) => {
    if (mode.source === 'role') return '这是这个角色自己注册的预设（从模板复制而来，改角色配置时重建）。';
    if (mode.available === false) return '这个模式现在组不出来：部署里没有它的预设声明。';
    return `直接读部署当前的预设声明${mode.rowCount === undefined ? '' : `（${mode.rowCount} 条顶层行）`}`;
  };
  // 当前模式来自哪里（几行）——原来印的是快照文件路径，用户 m11753：「放到说明里面」，
  // 于是收进「模式」标题旁的 ⓘ 说明里，行内不再显示。§5.62 起没有快照文件了：每一份
  // 都是「直接读部署当前的预设声明」。
  const chosenSource = chosen === undefined ? '' : describeMode(chosen);
  // 选中的是自己那份时，把模板单独说清楚：改模板会重建这份预设，但名字/身份不变。
  const templateNote = listed ? `模板：${role.modeLabel || role.mode}` : '';

  return h(
    'div',
    { style: styles.field },
    section(
      '模式',
      'modeIntro',
      note(
        describe(
          'modeIntro',
          '这个角色的能力行整体来自所选的模式（dsh 自带的或你自己建的 preset，插件只是引用）。',
        ),
        describe(
          'modeKeepsOverrides',
          '切换模式不改你在这个角色上做过的任何开关：覆盖是按行 id 存的，新模式里有同 id 的行就继续生效。',
        ),
        role.modeAvailable === false
          ? describe('modeSnapshotMissing', '这个模式现在组不出来（部署里没有它的预设声明），暂时按标准模式组装。')
          : '',
        current === 'minimal'
          ? describe(
              'modeMinimal',
              '极简模式只有 persona 与一个终端组：没有 agent-instructions 行，所以这个角色自己的 AGENTS.md 不会被读取，也没有上下文继承那一行可切。',
            )
          : '',
      ),
      undefined,
      note(chosenSource, templateNote),
    ),
    // 下拉框单独一行、撑满上限宽度（原来右边还挂着那串路径，见 `chosenSource`）。
    h(
      'select',
      {
        style: styles.select,
        value: current,
        disabled: busy,
        title: chosen === undefined ? undefined : describeMode(chosen),
        onChange: (event) => {
          const next = event.target.value;
          if (next !== current) onSet(next);
        },
      },
      options.map((mode) =>
        h(
          'option',
          {
            key: mode.id,
            value: mode.id,
            // 别的角色的自有预设列出来是为了「看得见全部预设」，但不能拿来当模板。
            disabled: mode.available === false || (mode.source === 'role' && mode.id !== actual),
            title: describeMode(mode),
          },
          mode.available === false ? `${mode.label}（不可用）` : mode.label,
        ),
      ),
    ),
  );
}

/**
 * 「既然成员名称必须是英文，那你再给一行设置 id 不就行了」。
 *
 * A role's id *is* the member name plus the `team-` prefix, so without an
 * explicit id a Chinese role name falls back to a codepoint hash
 * (`team-rfozlm`) — an id
 * nobody can remember and nobody chose. The create row takes the id
 * directly; this normalizes what was typed so a stray character never
 * reaches the host (which would reject it anyway, with a longer message).
 *
 * @param {string} value what the user typed.
 * @param {string} prefix the plugin's preset prefix (`state.presetPrefix`).
 * @returns {string} the full role id, or '' when nothing usable was typed.
 */

export { ModePanel };
