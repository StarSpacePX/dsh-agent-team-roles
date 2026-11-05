// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 容器视图：工具条 / 开关 / 新建行；列区交给 columns。

import { TeamRolesColumns } from './team-roles-columns.js';
import { describe, info, note } from './../notes.js';
import { h } from './../react.js';
import { styles } from './../styles.js';

function TeamRolesView(vm) {
  const { busy, draftMemberName, draftRoleId, error, newId, newName, run, setNewId, setNewName, setSelectedId, setTeamResult, state, teamResult } = vm;
  return h(
    'div',
// 页签页的宽度与居中在这里收口（设置面板当年给的宽度已经没了，见 styles.js 的 page）。
    { style: styles.page },
    h(
      'div',
      { style: styles.row },
// 「刷新」就是重新从磁盘读角色文件（reload），顺带重同步预设。
      h(
        'button',
        {
          style: styles.button,
          disabled: busy,
          title: describe(
            'refresh',
            '重新读磁盘上的角色文件（roles.json 与各角色的 role.json / AGENTS.md），再同步一次预设。说明文字来自 notes.json，缺失的键用插件内置的那份。',
          ),
          onClick: () => run({ action: 'reload' }),
        },
        '刷新',
      ),
// 说明表是数据，得有一条路把每个键写成文件给人看：一键写出，自己再改。
      h(
        'button',
        {
          style: styles.button,
          disabled: busy,
          title: describe(
            'exportNotes',
            '把当前用的说明文字整个写到 {file}（已经在那份文件里的键不会被覆盖），之后改那一份 json 就能集中改这些说明。',
            { file: state.notesFile || 'notes.json' },
          ),
          onClick: () => run({ action: 'export-notes' }),
        },
        '导出说明文件',
      ),
    ),
    state.notes && state.notes.error
      ? h('div', { style: styles.error }, `说明文件（notes.json）读不了：${state.notes.error}`)
      : null,
    state.error ? h('div', { style: styles.error }, `角色文件无法解析：${state.error}`) : null,
    state.registryError
      ? h(
          'div',
          { style: styles.hint },
          `读预设清单失败：${state.registryError} —— 角色是否真的挂载成功，这次无法确认。`,
        )
      : null,
    error ? h('div', { style: styles.error }, error) : null,
    h(
      'label',
      { style: styles.row },
      h('input', {
        type: 'checkbox',
        checked: state.team !== undefined && state.team.enabled === true,
// 三种「不能点」要分开：正忙、宿主侧没重启（字段还不存在）、这个部署没有可问的人
// （没有 pluginManager）。把最后一种画成普通的「关」会让人以为点一下就能开。
        disabled: busy || state.team === undefined || state.team.available !== true,
        onChange: async (event) => {
          const payload = await run({ action: 'set-team', enabled: event.target.checked });
          setTeamResult(payload && payload.result ? payload.result : null);
        },
      }),
      '启用智能体团队',
      info(
        state.team === undefined ? 'hostStale' : state.team.available !== true ? 'teamUnavailable' : state.team.enabled === true ? 'teamOn' : 'teamOff',
        note(
          state.team === undefined
            ? '宿主侧还没重启，重启 dsh 后这个开关才可用。'
            : state.team.available !== true
              ? state.team.reason
              : state.team.enabled === true
                ? `团队运行时已开${state.team.version ? `，组合包 ${state.team.version}` : ''}；委派的成员按名字认领同名角色。`
                : '默认关。打开后 dsh 会把这个组合包选进 profile 的组合，团队协作工具随之出现。',
          state.bindMembersSource === 'config'
            ? '插件配置里的 bindMembers 已强制打开成员绑定，这个开关关掉它也不受影响。'
            : '',
        ),
        {
// {version} 是 DEFAULT_NOTES 里的占位，带上这一句才不会留下字面量。
          version: state.team !== undefined && state.team.version ? `，组合包 ${state.team.version}` : '',
          reason: state.team === undefined ? '' : state.team.reason || '',
        },
      ),
    ),
    teamResult === null
      ? null
      : h(
          'div',
          { style: teamResult.error ? styles.error : styles.hint },
          `团队组合包：${teamResult.applicationLabel || teamResult.application || '已保存'}${
            teamResult.error ? ` —— ${teamResult.error}` : ''
          }${teamResult.warnings && teamResult.warnings.length > 0 ? `（${teamResult.warnings.join('；')}）` : ''}`,
        ),
// 新建区三行：两个输入框各占一整行，按钮单独一行（按钮不拉满，与「保存 / 全部还原 / 删除角色」那行一致）。
    h(
      'div',
      { style: styles.field },
      h('input', {
        style: styles.input,
        placeholder: '中文名，如：架构师',
        value: newName,
        onChange: (event) => setNewName(event.target.value),
      }),
    ),
// 成员名 = 角色 id 去掉 team- 前缀；留空才回落到按名字自动生成（中文名会变成 team-rfozlm 这种哈希）。
    h(
      'div',
      { style: styles.field },
      h('input', {
        style: styles.input,
        placeholder: '英文名，如：dev',
        value: newId,
        onChange: (event) => setNewId(event.target.value),
      }),
    ),
    h(
      'div',
      { style: styles.row },
      h(
        'button',
        {
          style: styles.button,
          disabled: busy || newName.trim().length === 0 || (newId.trim().length > 0 && draftRoleId === ''),
// 每个角色有自己的目录，这句说明收进按钮的悬浮提示里。
          title: describe(
            'createRole',
            '新建一个角色 = 建一个属于它的目录：role.json（这个角色的全部开关）+ AGENTS.md（从主会话复制一份，之后只用这份）。新角色的模式默认是标准模式。角色 ID 同时决定成员名（去掉 team- 前缀），留空则按名字自动生成。',
          ),
          onClick: async () => {
            const payload = await run({
              action: 'create-role',
              name: newName.trim(),
              ...(draftRoleId === '' ? null : { id: draftRoleId }),
            });
            if (payload && payload.id) setSelectedId(payload.id);
            setNewName('');
            setNewId('');
          },
        },
        '新建角色',
      ),
    ),
    newId.trim().length === 0
      ? null
      : h(
          'div',
          { style: draftRoleId === '' ? styles.error : styles.hint },
          draftRoleId === ''
            ? '角色 ID 只能用英文小写字母、数字和短横线（例如 devtest、qa-1）。'
            : `角色 ID：${draftRoleId} · 成员名：${draftMemberName}（spawn_teammate 用这个名字）`,
        ),
    h(TeamRolesColumns, vm),

  );
}

export { TeamRolesView };
