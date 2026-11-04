// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 群聊 tab：投影与事件窗口 hook。

import { TEAM_LOG_POLL_MS, TEAM_LOG_URL } from './../constants.js';
import { React } from './../react.js';
import { blockText } from './fold.js';

function useTeamProjection(sessionId) {
  const [projection, setProjection] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    let timer = null;
    const tick = async () => {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return;
      let next = null;
      try {
        const response = await fetch(
          `${TEAM_LOG_URL}?sessionId=${encodeURIComponent(sessionId)}`,
          { headers: { accept: 'application/json' } },
        );
        if (response.ok) {
          const payload = await response.json();
          // A payload without `messages` is not the projection: ignore it
          // rather than merge half a shape into the view.
          if (payload !== null && typeof payload === 'object' && Array.isArray(payload.messages)) next = payload;
        }
      } catch (error) {
        next = null;
      }
      if (alive === true && next !== null) setProjection(next);
    };
    const schedule = () => {
      timer = setTimeout(() => {
        const run = async () => {
          if (typeof document === 'undefined' || document.hidden !== true) await tick();
          if (alive === true) schedule();
        };
        void run();
      }, TEAM_LOG_POLL_MS);
    };
    void tick();
    schedule();
    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [sessionId]);
  return projection;
}

/** One-line preview of a message body for the dependency timeline. */
function shortText(content, max) {
  const flat = blockText(content).replace(/\s+/gu, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Fold a message list into **one row per participant pair**, in the order
 * each pair first appears. One mapping reads as one row (user m15312), so a
 * pair owns both directions: `left ⇄ right`, labelled with
 * each direction's @ count, and its timeline merges the rows of both
 * directions in seq order. A second developer therefore adds one row, not
 * two. Single-direction pairs keep the `A → B @n` shape.
 */
//--- foldPairs:start ---
function foldPairs(messages, nameById) {
  const pairs = new Map();
  for (const row of messages) {
    const message = row.message;
    const fromId = String(message.senderId);
    const toId = String(message.targetId);
    const key = fromId < toId ? `${fromId}~${toId}` : `${toId}~${fromId}`;
    let pair = pairs.get(key);
    if (pair === undefined) {
      pair = {
        key,
        leftId: fromId,
        leftName: typeof message.senderName === 'string' ? message.senderName : fromId,
        rightId: toId,
        rightName: nameById.get(toId) ?? toId,
        out: 0,
        back: 0,
        rows: [],
      };
      pairs.set(key, pair);
    }
    if (pair.leftId === fromId && pair.rightId === toId) pair.out += 1;
    else pair.back += 1;
    pair.rows.push(row);
  }
  return [...pairs.values()];
}
//--- foldPairs:end ---

/** Subscribe to one observable event-window source. */
function useEventWindow(subscribe, getWindow) {
  const [window, setWindow] = React.useState(() => getWindow());
  React.useEffect(() => {
    setWindow(getWindow());
    return subscribe(() => setWindow(getWindow()));
  }, [subscribe, getWindow]);
  return window;
}


export { useTeamProjection, shortText, foldPairs, useEventWindow };
