// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 能力表行抽取与过滤（MCP/技能/工具）。


const chatTab = {
  disposer: null,
  hidden: null,
  /**
   * 当前会话住在**监察员工作区**里 → 这个「群聊」页签让位给 dsh-arbiter-roles
   * 的「监察群」（用户 m01013/m01040）：普通会话看群聊、监察会话看监察群，两边
   * 不叠。这个值由 `entry.js` 按会话 cwd 算出来，跟用户的 `hideChatTab` 开关是
   * 两回事，任一为真就不挂。
   */
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

/**
 * The ability table. Rows are grouped by category and every group can be
 * folded shut — with the standard template that is 32 rows across 8 groups,
 * and 「技能」/「工具」/「委派」 are each long enough to bury the rest.
 *
 * There is deliberately **no per-row config editor**: the user asked for
 * switches only (「把配置/还原功能去掉，我只要开关就行」). `set-override`
 * still carries a row's `config` for the AGENTS.md panel, and 「还原默认」
 * here is what puts every row of this role back on the template (§5.29).
 */
// §5.55 — user m18131「搜索框以及统计好像对技能/mcp没有生效」.
//
// The filter box and the summary line used to look only at `role.rows`, so
// the MCP / 技能 blocks below them were neither filtered nor counted. The fix
// is one **enumeration per block** (`*Entries`), shared by the block itself
// and by the summary: the panel renders the entries, the summary counts them,
// and both therefore agree on what "matching" and "changed" mean. Two
// independent implementations would drift the first time one of them changes.
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
    // A server is "changed" exactly while the role denies it — the deny list is
    // the only thing this panel can write.
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
    // 「继承」 means this role made no choice at all: then every row is
    // untouched, whatever its checkbox shows.
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

/** The one filter rule, applied identically by the blocks and the summary. */
function filterEntries(entries, needle, onlyChanged) {
  return entries.filter((entry) => {
    if (onlyChanged && entry.changed !== true) return false;
    return needleMatches(needle, entry.text);
  });
}

// §5.55 — user m18765「插件里面的 mcp_connector / ego 等，为啥平铺出来的？我一个个
// 选得多麻烦？一个大类的要能整体勾选」.
//
// `tools.schemas()` answers with `{ name, description }` and nothing else: there
// is no owner / plugin field to group by (`…\dsh-tools\lib\types\index.js:665-677`
// `schemaOf()`). The only signal a tool name carries is its **prefix**, so tools
// sharing the part before the first `_` — and numbering at least
// `TOOL_GROUP_MIN` — become one collapsible group with a single select-all box.
// A group box writes exactly what the per-row boxes write (precise tool names),
// so one click is still one `set-switches` and one rebuild.
const TOOL_GROUP_MIN = 3;

/** @returns {string | null} the part before the first `_`, or null when there is none. */
function toolPrefix(name) {
  const text = String(name === null || name === undefined ? '' : name);
  const cut = text.indexOf('_');
  return cut <= 0 ? null : text.slice(0, cut);
}

/**
 * Split entries into groups plus loose rows. Computed from the **unfiltered**
 * list on purpose: a filter narrows the rows shown inside a group, it never
 * reshapes which groups exist.
 *
 * @returns {{ groups: { key: string, members: object[] }[], loose: object[] }}
 */
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
