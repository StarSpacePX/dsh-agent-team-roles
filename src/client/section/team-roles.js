// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 容器组件：按原顺序串 3 个 hook + 视图（hook 顺序不能变）。

import { h } from '../react.js';
import { styles } from '../styles.js';
import { useTeamRolesCore } from './team-roles-core.js';
import { useTeamRolesDrafts } from './team-roles-drafts.js';
import { useTeamRolesSwitches } from './team-roles-switches.js';
import { buildTeamRolesVm } from './team-roles-vm.js';
import { TeamRolesView } from './team-roles-view.js';

function TeamRolesSection() {
  const core = useTeamRolesCore();
  const drafts = useTeamRolesDrafts(core);
  const switches = useTeamRolesSwitches(core, drafts);
// 提前返回：state 还没到之前不能建 vm（buildTeamRolesVm 会读 state.presetPrefix），只画「正在读取角色…」。
// 必须落在调用 vm 之前，否则这段兜底形同虚设。
  if (core.state === null) {
    return h(
      'div',
      { style: styles.page },
      h('div', { style: styles.hint }, core.error || '正在读取角色…'),
    );
  }
  return h(TeamRolesView, buildTeamRolesVm(core, drafts, switches));
}

export { TeamRolesSection };
