// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 端点、节流与重试常量。


const STATE_URL = '/api/dsh-agent-team-roles/state';
const COMMAND_URL = '/api/dsh-agent-team-roles/command';
/**
 * 「监察员工作区」的唯一来源（用户 m01040）：`dsh-arbiter` 自己 `/state` 上那
 * 个已经解析好的 `workspaceDir`。只读它，不复制一份配置。
 *
 * 路径**不带 `/api`**——dsh-arbiter 注册的就是 `/dsh-arbiter/state`
 * （`plugins/dsh-arbiter/lib/http.js:222`），带上 `/api` 只会 404。
 */
const ARBITER_STATE_URL = '/dsh-arbiter/state';
/**
 * §5.50 — the host half's projection of the Lead's Session log (「群聊历史」).
 *
 * The browser only ever sees a **bounded tail** of the session log (§5.48), so
 * a team that worked earlier in a long session is invisible locally. The host
 * owns the whole log, so it folds it there and this view reads the result;
 * when the endpoint cannot answer (409/503/offline) the local window remains
 * the source, exactly as before.
 */
const TEAM_LOG_URL = '/api/dsh-agent-team-roles/team-log';
/**
 * §5.50 — how often the projection is re-read. The projection is incremental on
 * the host side (only new events are folded), so this is a cheap poll; four
 * seconds keeps the tab live without a long-lived stream to babysit.
 */
const TEAM_LOG_POLL_MS = 4000;
/**
 * §5.39 — how long a burst of switch clicks is allowed to gather before it
 * leaves as **one** `set-switches`. Long enough to merge the clicks of
 * someone flipping five rows, short enough that nobody notices it (the boxes
 * already moved when they were clicked).
 */
const SWITCH_BURST_MS = 120;
/**
 * §5.49 — 技能那一块的同一个 120ms 窗口（user m13923：「单选时为啥整个技能列都
 * 灰色，还这么慢」）。技能也是「一次手势 = 一条请求」，所以它跟开关共用这个窗口；
 * 单独的常量只是让将来想调的人一眼看到它跟开关是同一个节奏。
 */
const SKILL_BURST_MS = SWITCH_BURST_MS;
/**
 * §B2 — 失败提示的存活时间。任何一次成功的刷新都会顺手清掉它
 * （`refresh()` 成功路径无条件 `setError('')`），而 `flushSwitches` /
 * `flushSkills` 的 catch 里紧跟着就是一次 `await refresh()`，提示在真机上
 * 只活 ~43ms —— 用户根本看不到。所以由这个常量明确计时：出错就显示，
 * 到点自己消失；中途有操作成功则立刻清掉。
 */
const ERROR_TTL_MS = 8000;
/**
 * §B1 — 角色 id（`team-select`）→ id 框里显示的**裸成员名**（`select`）。
 *
 * 抽成函数是因为同步 effect 与"用户是不是改过 id"那处判断必须用同一条规则；
 * 而同步 effect 里那一行 `setIdDraft(...)` 必须保持内联的原始形状（见那里的注释）。
 */
const nakedMemberName = (id, prefix) => (id.startsWith(prefix) ? id.slice(prefix.length) : id);
/**
 * §E1 — 单个请求最多等多久。没有超时的话，一条半死的连接（进程还在、socket
 * 不回包）会让面板永远停在「正在读取角色…」，而且后面每一次刷新都排在它后面。
 */
const REQUEST_TIMEOUT_MS = 15000;
/**
 * §E1 — 幂等请求（GET/HEAD）的**总尝试次数**：3 = 首试 + 2 次重试。只有网络层
 * 错误与 5xx 算"可重试"；4xx 是服务端明确拒绝，重试只会得到同样的拒绝，
 * 非幂等的 POST 更不能替用户重放一次变更。
 */
const GET_ATTEMPTS = 3;
/** §E1 — 重试之间的固定间隔（平退避，够躲开一次瞬时抖动就够了）。 */
const RETRY_BACKOFF_MS = 200;

const CATEGORY_ORDER = ['agents-md', 'skill', 'tool', 'mcp', 'loop', 'group', 'other'];
const CATEGORY_LABEL = {
  // `persona` (the system prompt's identity line) and `agent-instructions`
  // (the rule files) are one thing to the user: 「agents.md 就是身份描述和
  // 一些规则」 (m05741). There is no 「身份」 category of its own.
  'agents-md': '身份与规则',
  skill: '技能',
  tool: '工具',
  mcp: 'MCP',
  loop: 'loop',
  group: '分组',
  other: '其它',
};


export { STATE_URL, COMMAND_URL, ARBITER_STATE_URL, TEAM_LOG_URL, TEAM_LOG_POLL_MS, SWITCH_BURST_MS, SKILL_BURST_MS, ERROR_TTL_MS, nakedMemberName, REQUEST_TIMEOUT_MS, GET_ATTEMPTS, RETRY_BACKOFF_MS, CATEGORY_ORDER, CATEGORY_LABEL };
