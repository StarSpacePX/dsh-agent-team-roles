// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 群聊 tab：投影与事件窗口 hook。

import { TEAM_LOG_URL } from './../constants.js';
import { React } from './../react.js';
import { blockText } from './fold.js';

function useTeamProjection(sessionId) {
  const [projection, setProjection] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    setProjection(null);
    const run = async () => {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return;
      let next = null;
      try {
        const response = await fetch(
          `${TEAM_LOG_URL}?sessionId=${encodeURIComponent(sessionId)}`,
          { headers: { accept: 'application/json' } },
        );
        if (response.ok) {
          const payload = await response.json();
// 没有 messages 的载荷不是投影：忽略，而不是把半个形状并进视图。
          if (payload !== null && typeof payload === 'object' && Array.isArray(payload.messages)) next = payload;
        }
      } catch (error) {
        next = null;
      }
      if (alive === true && next !== null) setProjection(next);
    };
    void run();
    return () => {
      alive = false;
    };
  }, [sessionId]);
  return projection;
}

/** 依赖时间线用的消息正文单行预览。 */
function shortText(content, max) {
  const flat = blockText(content).replace(/\s+/gu, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** 把消息列表折成每个「参与者对」一行，按每对第一次出现的顺序。
 * 一对拥有两个方向（left ⇄ right），用各自的 @ 次数标注，时间线按 seq 合并两个方向的行。
 * 所以再招一个开发者只多一行，不是两行；单向的对只有一行。 */
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

/** 订阅一个可观察的事件窗口源。 */
function useEventWindow(subscribe, getWindow) {
  const [window, setWindow] = React.useState(() => getWindow());
  React.useEffect(() => {
    setWindow(getWindow());
    return subscribe(() => setWindow(getWindow()));
  }, [subscribe, getWindow]);
  return window;
}

/** 订阅同团队的其它会话。一条转达消息只落在**收件人**的会话里，所以这一页要同时
 * 看「本会话 + 同团队的其它会话」——Lead→成员在成员的日志里，成员→Lead 在 Lead 的
 * 日志里，只看本会话会漏掉一半。
 *
 * @param {{ id: string, source: object }[]} partners 宿主页给的表（已排掉本会话）
 * @param {string} key partners 的稳定指纹：id 集合不变就不重订阅
 * @returns {{ receiverId: string, window: object }[]} */
function useRelayWindows(partners, key) {
  const snapshot = React.useCallback(
    () =>
      partners.map((partner) => ({
        receiverId: partner.id,
        window: partner.source.getSnapshot(),
      })),
    [partners],
  );
  const [windows, setWindows] = React.useState(() => snapshot());
  React.useEffect(() => {
    const sync = () => setWindows(snapshot());
    sync();
    const offs = [];
    for (const partner of partners) {
      if (partner !== null && typeof partner === 'object' && typeof partner.source?.subscribe === 'function') {
        offs.push(partner.source.subscribe(sync));
      }
    }
    return () => {
      for (const off of offs) if (typeof off === 'function') off();
    };
  }, [key]);
  return windows;
}

export { useTeamProjection, shortText, foldPairs, useEventWindow, useRelayWindows };
