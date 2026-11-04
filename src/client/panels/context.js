// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 上下文继承面板。

import { describe, note, section } from './../notes.js';
import { h } from './../react.js';
import { styles } from './../styles.js';

function ContextPanel({ role, busy, onSet }) {
  const row = role.rows.find((item) => item.id === 'tool-subagent');
  if (row === undefined) {
    return h(
      'div',
      { style: styles.field },
      section(
        '上下文继承主会话',
        'contextNoRow',
        `这个模式（${role.modeLabel || role.mode || 'standard'}）里没有 delegation/tool-subagent 这一行，这个角色没有可切换的委派工具。`,
      ),
    );
  }

  const templateProvider = String((row.templateConfig && row.templateConfig.provider) ?? 'spawn');
  const provider = String((row.config && row.config.provider) ?? templateProvider);
  const inherit = provider === 'fork';

  return h(
    'div',
    { style: styles.field },
    section(
      '上下文继承主会话',
      inherit ? 'contextOn' : 'contextOff',
      note(
        describe(
          inherit ? 'contextOn' : 'contextOff',
          inherit
            ? '开：委派走 fork provider —— 成员带上本会话已结束轮次的上下文。'
            : '关：委派走 spawn provider —— 成员是全新 Agent，零继承。',
        ),
        describe(
          'contextProvider',
          '（改的是模板里已有的 delegation/tool-subagent 行的 provider：{provider}；工具名不变，还是 subagent）',
          { provider },
        ),
        describe(
          'contextOtherTool',
          '这个角色的 subagent_fork 工具不受影响，模型需要时仍可自己选；这里只决定默认那个 subagent 的继承方式。',
        ),
      ),
    ),
    h(
      'div',
      { style: styles.row },
      h('input', {
        type: 'checkbox',
        disabled: busy,
        checked: inherit,
        title: inherit
          ? '这个角色派出的成员继承本会话已完成的对话'
          : '这个角色派出的成员全新开始，零上下文继承',
        onChange: (event) => onSet(event.target.checked),
      }),
      h('span', null, '成员继承主会话上下文'),
    ),
  );
}

/** 「技能也要能单独配置」。前提不成立：预设是内存里的声明，每个角色本来就是它模式的派生副本
 * （buildDefinition），所以什么都不用从安装目录拷出来 —— 预设文件、技能目录都不拷。
 * skill-filesystem 那一行本来就带两个旋钮。 */

export { ContextPanel };
