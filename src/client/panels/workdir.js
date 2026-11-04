// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 工作目录面板。

import { describe, info, note, section } from './../notes.js';
import { h } from './../react.js';
import { styles } from './../styles.js';

function WorkdirPanel({ role, workdir, busy, onReset }) {
  if (workdir === undefined) {
    return h(
      'div',
      { style: styles.field },
      section(
        '角色工作目录',
        'workdirNoState',
        '宿主半还没重启，这次 /state 里还没有这一段。',
      ),
    );
  }

  const standard = workdir && workdir.standard;
  const parallel =
    standard && standard.config && standard.config.maxParallelToolCalls != null
      ? standard.config.maxParallelToolCalls
      : null;
  // §5.34 — one of three keys, so each of the three states is editable in
  // notes.json like every other explanation.
  const linkedKey =
    role.agentsMd && role.agentsMd.linked === true
      ? role.agentsMd.hasRow === false
        ? 'workdirNoRow'
        : 'workdirLinked'
      : 'workdirUnlinked';

  return h(
    'div',
    { style: styles.field },
    section(
      '角色工作目录',
      'workdirIntro',
      note(
        describe(
          'workdirIntro',
          '这个角色的规则文件就是这个目录里的 AGENTS.md，直接去改它就行：dsh 已经把这个文件接到该角色的 agent-instructions 行上，不管任务在哪个目录跑都会加载它。',
        ),
        role.agentsMd && role.agentsMd.source
          ? describe('workdirSource', '（新建时复制自 {source}）', { source: role.agentsMd.source })
          : describe('workdirNoSource', '（新建时没有可复制的来源，插件生成的空模板）'),
        standard
          ? describe(
              'workdirWithLoop',
              '任务在哪个目录跑由新建任务时选的目录决定，预设改不了它；部署的 agent-loop 也是全局的（maxParallelToolCalls={parallel}，角色不能各自覆盖）。',
              { parallel: parallel == null ? '(默认)' : parallel },
            )
          : describe(
              'workdirWithoutLoop',
              '任务在哪个目录跑由新建任务时选的目录决定，预设改不了它；本部署里没有 agent-loop 行。',
            ),
      ),
    ),
    h('div', { style: styles.pre }, role.dir || '(未知)'),
    h(
      'div',
      { style: styles.row },
      h(
        'button',
        {
          style: styles.button,
          disabled: busy,
          title: describe(
            'workdirReset',
            '重新从主会话复制一份 AGENTS.md 覆盖这个角色目录里的文件，并清掉这个角色改过的 AGENTS.md 发现规则',
          ),
          onClick: onReset,
        },
        '还原默认',
      ),
      info(
        linkedKey,
        {
          workdirNoRow: '规则文件没接入：这个模式里没有 agent-instructions 行（见上面「模式」）',
          workdirLinked: '规则文件已接入这个角色',
          workdirUnlinked: '规则文件还没接入（角色条目异常）',
        }[linkedKey],
      ),
    ),
  );
}

/**
 * §5.32 / §5.40 — which mode this role is built from.
 *
 * The *set* is the deployment's business (m09580 「改成多选框，从现有的模式中加载
 * … 不要写死」; 默认是标准模式，见 m07307). The list comes
 * from `state.modes`, which the host half fills from `agentPresets.list()`
 * — so a preset the user creates or deletes changes these candidates with
 * no plugin change, and the four modes dsh ships are just the ones that
 * happen to be there out of the box.
 *
 * It is a `<select>` even though the user said 「多选框」: a role has exactly
 * one mode, and a row of checkboxes would let the UI say something the data
 * cannot. A single-choice list is what that control means here.
 *
 * A mode with no usable composition is listed but disabled, with the reason
 * in its tooltip, instead of silently behaving like 标准模式.
 */

export { WorkdirPanel };
