// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 能力表行抽取与过滤（MCP / 技能 / 工具）。

const chatTab = {
  disposer: null,
  hidden: null,
/** 当前会话住在监察员工作区里 → 这个「群聊」页签让位给 dsh-arbiter-roles 的「监察群」：
 * 普通会话看群聊、监察会话看监察群，两边不叠。这个值由 entry.js 按会话 cwd 算出，
 * 与用户 hideChatTab 开关是两回事，任一为真就不挂。 */
  outOfScope: false,
  stopped: true,
  mount: null,
  unmount: null,
  apply() {
    if (this.hidden === true || this.outOfScope === true) this.unmount();
    else this.mount();
  },
  setHidden(hidden) {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    this.apply();
  },
  setOutOfScope(value) {
    const next = value === true;
    if (this.outOfScope === next) return;
    this.outOfScope = next;
    this.apply();
  },
};

/** 能力表：行按分类分组，每组可折叠（标准模板 32 行 8 组，技能 / 工具 / 委派各自长到能盖住别的）。
 * 故意没有逐行配置编辑器：用户只要开关。set-override 仍携带行的 config 供 AGENTS.md 使用。 */
const needleMatches = (needle, text) => {
  if (needle.length === 0) return true;
  return String(text === null || text === undefined ? '' : text).toLowerCase().includes(needle);
};

/** @returns {{ key: string, item: object, text: string, off: boolean, changed: boolean }[]} */
function mcpEntries(role, mcp) {
  const services = (mcp && mcp.services) || [];
  const deny = new Set((((role.capabilities || {}).mcp || {}).deny) || []);
  return services.map((service) => ({
    key: `mcp:${service.serverName}`,
    item: service,
    text: `${service.serverName || ''} ${service.label || ''}`,
    off: deny.has(service.serverName),
// 一个 server 恰好在这个角色 deny 它时算「改过」：deny 名单是这块面板唯一能写的东西。
    changed: deny.has(service.serverName),
  }));
}

/** @returns {{ key: string, item: object, text: string, off: boolean, changed: boolean }[]} */
function skillEntries(role, skills) {
  const available = (skills && skills.available) || [];
  const decision = role.skills || { mode: 'inherit', ids: [] };
  const pick = decision.mode === 'pick';
  const chosen = new Set(decision.ids || []);
  return available.map((skill) => ({
    key: `skill:${skill.name}`,
    item: skill,
    text: `${skill.name || ''} ${skill.description || ''} ${skill.rootLabel || ''}`,
    off: pick && !chosen.has(skill.name),
// 「继承」表示这个角色什么都没选：那每一行都算未改动，不管勾选框显示什么。
    changed: pick,
  }));
}

/** @returns {{ key: string, item: object, text: string, off: boolean, changed: boolean }[]} */
function toolEntries(role, toolGate) {
  const tools = (toolGate && toolGate.tools) || [];
  const deny = new Set((((role.capabilities || {}).toolGate || {}).deny) || []);
  return tools.map((tool) => ({
    key: `tool:${tool.name}`,
    item: tool,
    text: `${tool.name || ''} ${tool.description || ''}`,
    off: deny.has(tool.name),
    changed: deny.has(tool.name),
  }));
}

/** 唯一的过滤规则，各块与汇总用同一份。 */
function filterEntries(entries, needle, onlyChanged) {
  return entries.filter((entry) => {
    if (onlyChanged && entry.changed !== true) return false;
    return needleMatches(needle, entry.text);
  });
}

// tools.schemas() 只答 { name, description }，没有 owner / plugin 字段可分组；
// 工具名唯一带的信号是前缀，所以把第一个 _ 之前相同的归成一组。
const TOOL_GROUP_MIN = 3;

/** @returns {string | null} 第一个 _ 之前的部分，没有就 null。 */
function toolPrefix(name) {
  const text = String(name === null || name === undefined ? '' : name);
  const cut = text.indexOf('_');
  return cut <= 0 ? null : text.slice(0, cut);
}

/** 把条目分成「组 + 散行」。故意基于**未过滤**的列表算：过滤只收窄组内显示的行，不改变有哪些组。
 * @returns {{ groups: { key: string, members: object[] }[], loose: object[] }} */
function groupTools(entries) {
  const buckets = new Map();
  const loose = [];
  for (const entry of entries) {
    const key = toolPrefix(entry.item.name);
    if (key === null) {
      loose.push(entry);
      continue;
    }
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(entry);
  }
  const groups = [];
  for (const [key, members] of buckets) {
    if (members.length >= TOOL_GROUP_MIN) groups.push({ key, members });
    else for (const member of members) loose.push(member);
  }
  groups.sort((a, b) => a.key.localeCompare(b.key));
  loose.sort((a, b) => String(a.item.name).localeCompare(String(b.item.name)));
  return { groups, loose };
}

export { chatTab, needleMatches, mcpEntries, skillEntries, toolEntries, filterEntries, TOOL_GROUP_MIN, toolPrefix, groupTools };
