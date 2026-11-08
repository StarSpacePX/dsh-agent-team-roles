// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 群聊 tab：把窗口里的转达消息折成消息行（时钟 / 正文）。

//#region 群聊 tab（R7.5 / R7.7 / R7.8）

// 时钟：一律带日期（群聊会跨天，只给时分秒分不清是哪一天）。
// 格式固定 yyyy-mm-dd hh:mm:ss，下拉、消息行、展开时间线共用同一口径。
function formatClock(time) {
  if (typeof time !== 'number' || Number.isFinite(time) !== true) return '';
  const date = new Date(time);
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
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

/** 转达消息：宿主不再写 `team/message/*`，消息改成投递时的一条通用事件
 * `agent/inbox/spliced`，落在**收件人**那个会话的日志里。
 *
 * 群聊页因此要同时看「本会话 + 同团队的其它会话」的窗口：一条 Lead→成员的消息只在
 * 成员会话里，只看本会话会漏掉一半。这个函数把**一个窗口**里属于 `receiverId` 的
 * 转达消息折成消息行；调用方把多个窗口的结果拼起来。 */
const RELAY_EVENT_TYPE = 'agent/inbox/spliced';
/** 运行时给转达消息加的抬头（`Team message from devtest:`），进群聊前剥掉。 */
const SPEAKER_PREFIX = /^Team message from [^:\n]+:\s*$/;

function relayRowsFromWindow(window, receiverId) {
  const rows = [];
  const entries =
    window !== null && window !== undefined && Array.isArray(window.entries) ? window.entries : [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || entry.type !== 'event') continue;
    const event = entry.event;
    if (event === null || typeof event !== 'object' || event.type !== RELAY_EVENT_TYPE) continue;
    const data = event.data;
    if (data === null || typeof data !== 'object' || Array.isArray(data.inserted) !== true) continue;
    for (const [index, inserted] of data.inserted.entries()) {
      if (inserted === null || typeof inserted !== 'object') continue;
      const source = inserted.source;
      if (source === null || typeof source !== 'object' || source.kind !== 'agent-message') continue;
      const senderId = typeof source.senderSessionId === 'string' ? source.senderSessionId : '';
      const texts = [];
      for (const block of Array.isArray(inserted.content) ? inserted.content : []) {
        if (block !== null && typeof block === 'object' && typeof block.text === 'string') texts.push(block.text);
      }
      while (texts.length > 0 && SPEAKER_PREFIX.test(texts[0].trim()) === true) texts.shift();
      const body = texts.join('\n');
      if (body.trim() === '') continue;
// 运行时这里不给持久消息 id，身份只能用唯一稳定的元组：发送者 + 这次接收事件。
      rows.push({
        message: {
          id: `relay:${senderId}:${String(event.seq)}:${index}`,
          senderId,
          targetId: receiverId,
          content: [{ type: 'text', text: body }],
        },
        seq: Number(event.seq),
        time: Number(event.time),
        delivered: true,
      });
    }
  }
  return rows;
}

/** 把多个团队的窗口折成一份有序的转达消息列表。
 * 行来自不同会话的日志，`seq` 是各自会话的计数器、不可比，所以按 `time` 排序。 */
function foldRelayMessages(sources) {
  const byId = new Map();
  for (const source of Array.isArray(sources) ? sources : []) {
    if (source === null || typeof source !== 'object') continue;
    for (const row of relayRowsFromWindow(source.window, source.receiverId)) {
      if (byId.has(row.message.id) !== true) byId.set(row.message.id, row);
    }
  }
  return [...byId.values()].sort((left, right) => (left.time ?? 0) - (right.time ?? 0));
}


export { formatClock, blockText, foldRelayMessages };
