// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 模式面板。

import { describe, note, section } from './../notes.js';
import { h } from './../react.js';
import { styles } from './../styles.js';

function ModePanel({ role, modes, busy, onSet }) {
  const list = Array.isArray(modes) && modes.length > 0 ? modes : null;
// 默认选中「这条角色实际挂的预设」（= 它自己那份复制品，/state 里叫 role.presetId），
// 不是模板（role.mode）。只显示模板会让「看到 user、实际挂的是复制品」变成骗人的显示。
  const actual = typeof role.presetId === 'string' && role.presetId !== '' ? role.presetId : '';
  const listed = list !== null && actual !== '' && list.some((mode) => mode.id === actual);
  const current = listed ? actual : role.mode || 'standard';
  const known = list === null ? [] : list.map((mode) => mode.id);
// 角色自己的模式永远是一个选项，哪怕 roster 已经不再提供它（预设被删）
// 已存盘的角色必须还能读，也不能只是打开面板就把值悄悄跳到别的模式。
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
        '宿主侧还没重启，这次 /state 里还没有 modes 段。',
      ),
    );
  }

  const describeMode = (mode) => {
    if (mode.source === 'role') return '这是这个角色自己注册的预设（从模板复制而来，改角色配置时重建）。';
    if (mode.available === false) return '这个模式现在组不出来：部署里没有它的预设声明。';
    return `直接读部署当前的预设声明${mode.rowCount === undefined ? '' : `（${mode.rowCount} 条顶层行）`}`;
  };
// 当前模式从哪来：收进「模式」标题旁的 ⓘ 说明，行内不显示。
// 没有快照文件了，每一份都是直接读部署当前的预设声明。
  const chosenSource = chosen === undefined ? '' : describeMode(chosen);
// 选中的是自己那份时，把模板单独说清楚：改模板会重建这份预设，但名字 / 身份不变。
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
// 下拉框单独一行、撑满上限宽度。
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
// 别的角色的自有预设列出来是为了「看得见全部预设」，但不能当模板。
            disabled: mode.available === false || (mode.source === 'role' && mode.id !== actual),
            title: describeMode(mode),
          },
          mode.available === false ? `${mode.label}（不可用）` : mode.label,
        ),
      ),
    ),
  );
}

/** 「再给一行设置 id」：角色 id 就是成员名带 team- 前缀，
 * 不显式给 id 时中文角色名会回落到码点哈希（team-rfozlm 这种没人记得的名字）。
 * 新建行直接收 id，这里把输入规范化，杂字符到不了宿主（宿主会拒）。 */

export { ModePanel };
