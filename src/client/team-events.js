// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 从 Lead 会话的事件窗口折出团队成员与任务：@ 候选列表在共享投影缺失时靠它兜底。

/** 把一段原始会话事件窗口折成成员与任务。
 * 纯函数：只读 window，不改它的条目。team/member 与 team/task 都是整值记录，按 id 取最新即赢。
 * 已删除的任务丢掉，界面不该再展示。 */
function foldTeamEvents(window) {
  const members = new Map();
  const tasks = new Map();

  const entries =
    window !== null && window !== undefined && Array.isArray(window.entries) ? window.entries : [];

  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || entry.type !== 'event') continue;
    const event = entry.event;
    if (event === null || typeof event !== 'object') continue;
    const data = event.data;
    if (data === null || typeof data !== 'object') continue;

    if (event.type === 'team/member' && data.member !== null && typeof data.member === 'object') {
      members.set(data.member.id, data.member);
    } else if (event.type === 'team/task' && data.task !== null && typeof data.task === 'object') {
      tasks.set(data.task.id, data.task);
    }
  }

  return {
    members: [...members.values()],
    tasks: [...tasks.values()].filter((task) => task.status !== 'deleted'),
  };
}

export { foldTeamEvents };
