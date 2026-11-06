// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 端点、节流与重试常量。

const STATE_URL = '/api/dsh-agent-team-roles/state';
const COMMAND_URL = '/api/dsh-agent-team-roles/command';
/** 「监察员工作区」的唯一来源：dsh-arbiter 自己 /state 上那个已解析好的 workspaceDir，只读不复制配置。
 * 路径不带 /api —— dsh-arbiter 注册的就是 /dsh-arbiter/state，带上只会 404。 */
const ARBITER_STATE_URL = '/dsh-arbiter/state';
/** 宿主侧对 Lead 会话日志的投影（群聊历史）：浏览器只拿得到有界的尾巴，
 * 早前干过活的团队在本地看不见；宿主持有整份日志，折好放在这里。端点答不上时保留本地窗口。 */
const TEAM_LOG_URL = '/api/dsh-agent-team-roles/team-log';
/** 多久重读一次投影。宿主侧是增量折叠，所以这是廉价轮询；4 秒让页签保持活，也不用维护长连接。 */
const TEAM_LOG_POLL_MS = 4000;
/** 一串开关点击攒多久再合成一条 set-switches：够合并连点五行，短到没人察觉（点下去时勾选框已经动了）。 */
const SWITCH_BURST_MS = 120;
/** 技能块用同一个 120ms 窗口：技能也是「一次手势 = 一条请求」，共用同一节奏。 */
const SKILL_BURST_MS = SWITCH_BURST_MS;
/** 失败提示的存活时间。每次成功刷新都会清掉它，而 flushSwitches / flushSkills 的 catch
 * 后面紧跟一次 refresh，提示在真机上只活约 43ms、根本看不见。
 * 所以由这个常量明确计时：出错就显示，到点自己消失。 */
const ERROR_TTL_MS = 8000;
/** 角色 id（team-select）→ id 框里显示的裸成员名（select）。
 * 抽成函数是因为同步 effect 与「用户是否改过 id」那处判断必须用同一条规则。 */
const nakedMemberName = (id, prefix) => (id.startsWith(prefix) ? id.slice(prefix.length) : id);
/** 单个请求最多等多久。没有超时，一条半死的连接（socket 不回包）会让面板永远停在「正在读取角色…」。 */
const REQUEST_TIMEOUT_MS = 15000;
/** 幂等请求（GET/HEAD）的总尝试次数：3 = 首试 + 2 次重试。
 * 只有网络错误与 5xx 可重试；4xx 是服务端明确拒绝，非幂等的 POST 更不能替用户重放变更。 */
const GET_ATTEMPTS = 3;
/** 重试之间的固定间隔（平退避，躲开一次瞬时抖动就够）。 */
const RETRY_BACKOFF_MS = 200;

const CATEGORY_ORDER = ['agents-md', 'skill', 'tool', 'mcp', 'loop', 'group', 'other'];
const CATEGORY_LABEL = {
// persona（系统提示词的身份行）和 agent-instructions（规则文件）对用户是一件事
// AGENTS.md 就是身份描述加一些规则。没有独立的「身份」分类。
  'agents-md': '身份与规则',
  skill: '技能',
  tool: '工具',
  mcp: 'MCP',
  loop: 'loop',
  group: '分组',
  other: '其它',
};

export { STATE_URL, COMMAND_URL, ARBITER_STATE_URL, TEAM_LOG_URL, TEAM_LOG_POLL_MS, SWITCH_BURST_MS, SKILL_BURST_MS, ERROR_TTL_MS, nakedMemberName, REQUEST_TIMEOUT_MS, GET_ATTEMPTS, RETRY_BACKOFF_MS, CATEGORY_ORDER, CATEGORY_LABEL };
