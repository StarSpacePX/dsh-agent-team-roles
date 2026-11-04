// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
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

/** Flatten one message's content blocks into display text. */
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

/**
 * Fold one raw Session event window into the team timeline. Pure: reads
 * nothing outside `window` and mutates none of its entries.
 *
 * `team/member` and `team/task` are whole-value records, so the latest event
 * per id wins. `team/message/queued` is the durable enqueue and
 * `team/message/delivered` carries only an id, so delivery is a second pass.
 */
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

/**
 * §5.50 — merge the host's projection into the locally folded window.
 *
 * The two describe the same log from two vantage points: the projection is
 * complete but up to `TEAM_LOG_POLL_MS` old, the window is live but only a
 * tail. They are merged by id rather than by "one wins", because during a
 * burst the newest events exist only in the window and the oldest only in the
 * projection.
 *
 *   - members / tasks: whole-value records — keyed by id; for a shared id the
 *     local window wins (it is the side that has seen the newest event).
 *   - messages: keyed by the durable message id; the larger `seq` wins and
 *     delivery seen by either side counts, so a message is never shown twice
 *     nor flipped back to 「排队中」 by a stale poll.
 *
 * `hasMore` becomes false: the projection folds the log from its first event,
 * so once it answers there is nothing left to page back for.
 */
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

/**
 * §5.50 — poll the host projection for one Session.
 *
 * Returns `null` until (and whenever) the host cannot answer, which is the
 * signal for the caller to keep using the local window. Polling stops while
 * the tab is hidden: a background tab has no one to show the result to.
 */

export { formatClock, blockText, foldTeamEvents, mergeTeamLog };
