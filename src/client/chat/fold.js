// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 群聊 tab：事件折叠（时钟 / 正文 / 去重合并）。

//#region 群聊 tab（R7.5 / R7.7 / R7.8）
/**
 * The shipped Agent Teams UI states its own limitation in its README:
 * 「**没有 mailbox timeline**——投影视图只承载 roster 与任务；不显示 peer 消息」。
 *
 * The messages are not actually invisible — they are durable Session events of
 * the **Lead Session**: `team/message/queued` carries the whole
 * `TeamMessageSnapshot` (sender, target, content) and `team/message/delivered`
 * carries the ack, both with the session's own `seq` and `time`. A browser
 * plugin can read that window, so this tab renders exactly what the log says.
 * Nothing here is inferred, synthesised or faked: when the deployment has no
 * Agent Teams activity, the tab says so instead of inventing a conversation.
 */

function formatClock(time) {
  if (typeof time !== 'number' || Number.isFinite(time) !== true) return '';
  const date = new Date(time);
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 把一条消息的 content blocks 拍平成显示文本。 */
function blockText(content) {
  if (Array.isArray(content) !== true) return '';
  const parts = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    if (typeof block.text === 'string') parts.push(block.text);
    else if (typeof block.type === 'string') parts.push(`[${block.type}]`);
  }
  return parts.join('\n');
}

/** 把一段原始会话事件窗口折成团队时间线。纯函数：不读 window 之外的东西，也不改它的条目。
 * team/member 与 team/task 是整值记录，按 id 取最新即赢；
 * team/message/queued 是持久入队、delivered 只带 id，所以送达是第二遍。 */
function foldTeamEvents(window) {
  const members = new Map();
  const tasks = new Map();
  const messages = [];
  const byId = new Map();
  const delivered = new Set();
  let teamId = null;

  const entries =
    window !== null && window !== undefined && Array.isArray(window.entries) ? window.entries : [];

  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || entry.type !== 'event') continue;
    const event = entry.event;
    if (event === null || typeof event !== 'object') continue;
    const data = event.data;
    if (data === null || typeof data !== 'object') continue;
    if (typeof data.teamId === 'string') teamId = data.teamId;

    if (event.type === 'team/member' && data.member !== null && typeof data.member === 'object') {
      members.set(data.member.id, data.member);
    } else if (event.type === 'team/task' && data.task !== null && typeof data.task === 'object') {
      tasks.set(data.task.id, data.task);
    } else if (
      event.type === 'team/message/queued' &&
      data.message !== null &&
      typeof data.message === 'object'
    ) {
      const message = data.message;
      const existing = byId.get(message.id);
      if (existing === undefined) {
        const row = { message, seq: event.seq, time: event.time };
        byId.set(message.id, row);
        messages.push(row);
      } else {
        existing.seq = event.seq;
        existing.time = event.time;
      }
    } else if (event.type === 'team/message/delivered' && typeof data.messageId === 'string') {
      delivered.add(data.messageId);
    }
  }

  for (const row of messages) row.delivered = delivered.has(row.message.id);

  return {
    members: [...members.values()],
    tasks: [...tasks.values()].filter((task) => task.status !== 'deleted'),
    messages,
    teamId,
    hasMore: window !== null && window !== undefined && window.hasMore === true,
  };
}

/** 把宿主侧的投影并进本地折叠的窗口。
 * 两者描述同一份日志的两个视角：投影完整但最多旧 TEAM_LOG_POLL_MS，窗口实时但只有尾巴。
 * 按 id 合并而不是「谁赢」，因为爆发期最新事件只存在于窗口里、最早的只存在于投影里。 */
function mergeTeamLog(folded, projection) {
  if (projection === null || projection === undefined) return folded

  const members = new Map();
  for (const member of projection.members ?? []) {
    if (member !== null && typeof member === 'object') members.set(String(member.id), member);
  }
  for (const member of folded.members) members.set(String(member.id), member);

  const tasks = new Map();
  for (const task of projection.tasks ?? []) {
    if (task !== null && typeof task === 'object') tasks.set(String(task.id), task);
  }
  for (const task of folded.tasks) tasks.set(String(task.id), task);

  const byId = new Map();
  const keep = (row) => ({
    message: row.message,
    seq: row.seq ?? null,
    time: row.time ?? null,
    delivered: row.delivered === true,
  });
  for (const row of projection.messages ?? []) {
    if (row !== null && typeof row === 'object' && row.message !== null && row.message !== undefined) {
      byId.set(String(row.message.id), keep(row));
    }
  }
  for (const row of folded.messages) {
    const id = String(row.message.id);
    const existing = byId.get(id);
    if (existing === undefined) {
      byId.set(id, keep(row));
      continue;
    }
    const newer = (row.seq ?? 0) >= (existing.seq ?? 0) ? row : existing;
    byId.set(id, {
      message: newer.message,
      seq: newer.seq ?? null,
      time: newer.time ?? null,
      delivered: row.delivered === true || existing.delivered === true,
    });
  }

  const messages = [...byId.values()].sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
  const teamId = folded.teamId ?? (typeof projection.teamId === 'string' ? projection.teamId : null);
  return {
    members: [...members.values()],
    tasks: [...tasks.values()].filter((task) => task.status !== 'deleted'),
    messages,
    teamId,
    hasMore: false,
    projected: true,
  };
}

/** 轮询某个会话的宿主投影。宿主答不上就返回 null，调用方继续用本地窗口；
 * 页签隐藏时停止轮询 —— 后台页签没人看结果。 */

export { formatClock, blockText, foldTeamEvents, mergeTeamLog };
