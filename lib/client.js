/**
 * `dsh-agent-team-roles` — 浏览器半边（构建产物，请勿手工修改）。
 *
 * 源码在 `src/client/**`，由 `node tools/build-client.mjs` 生成这个文件。
 * 改代码请改源码，然后跑 `npm run build:client`；`npm test` 里带 `--check` 守着它不漂。
 *
 * 模块清单（依赖顺序）：
 *   ./team-events.js
 *   ./constants.js
 *   ./net.js
 *   ./react.js
 *   ./tokens.js
 *   ./styles.js
 *   ./notes.js
 *   ./section/team-roles-core.js
 *   ./section/team-roles-drafts.js
 *   ./section/team-roles-switches.js
 *   ./section/role-id.js
 *   ./section/team-roles-vm.js
 *   ./entries.js
 *   ./panels/context.js
 *   ./panels/grouped-table.js
 *   ./panels/mcp.js
 *   ./panels/mode.js
 *   ./panels/model.js
 *   ./panels/plugins.js
 *   ./panels/skills.js
 *   ./panels/workdir.js
 *   ./section/team-roles-columns.js
 *   ./section/team-roles-view.js
 *   ./section/team-roles.js
 *   ./entry.js
 */
window.__ModuleLoader__.load({
  id: "dsh-agent-team-roles",
  factory: (require) => {
    // 极简模块表：只服务本 bundle。导入说明符在构建时已解析成模块 id，运行时不做路径解析。
    const __modules = new Map();
    const __define = (id, body) => {
      __modules.set(id, { body, exports: null, loaded: false });
    };
    const __load = (id) => {
      const mod = __modules.get(id);
      if (mod === undefined) throw new Error(`dsh-agent-team-roles: 未知的客户端模块 ${id}`);
      if (!mod.loaded) {
        mod.loaded = true;
        mod.exports = {};
        mod.body(mod.exports, __load);
      }
      return mod.exports;
    };

    __define("./team-events.js", (exports, __load) => {
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

      exports.foldTeamEvents = foldTeamEvents;

    });

    __define("./constants.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 端点、节流与重试常量。

      const STATE_URL = '/api/dsh-agent-team-roles/state';
      const COMMAND_URL = '/api/dsh-agent-team-roles/command';
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

      exports.STATE_URL = STATE_URL;
      exports.COMMAND_URL = COMMAND_URL;
      exports.SWITCH_BURST_MS = SWITCH_BURST_MS;
      exports.SKILL_BURST_MS = SKILL_BURST_MS;
      exports.ERROR_TTL_MS = ERROR_TTL_MS;
      exports.nakedMemberName = nakedMemberName;
      exports.REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
      exports.GET_ATTEMPTS = GET_ATTEMPTS;
      exports.RETRY_BACKOFF_MS = RETRY_BACKOFF_MS;
      exports.CATEGORY_ORDER = CATEGORY_ORDER;
      exports.CATEGORY_LABEL = CATEGORY_LABEL;

    });

    __define("./net.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // HTTP 层：超时、重试、命令节流、状态读取。

      const { COMMAND_URL, GET_ATTEMPTS, REQUEST_TIMEOUT_MS, RETRY_BACKOFF_MS, STATE_URL } = __load('./constants.js');

      async function timedFetch(url, init) {
        if (typeof AbortController !== 'function') return fetch(url, init);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          return await fetch(url, { ...init, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
      }

      /** 幂等请求的有限重试。只重试「可能自己好起来」的失败：网络层错误与 5xx。
       * 4xx 立刻抛（重试同样的请求只会得到同样的拒绝），非幂等请求只试一次，绝不替用户重放变更。
       * @param {string} url @param {object} [init] @returns {Promise<Response>} */
      async function requestWithRetry(url, init = {}) {
        const method = String(init.method || 'GET').toUpperCase();
        const idempotent = method === 'GET' || method === 'HEAD';
        const attempts = idempotent ? GET_ATTEMPTS : 1;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
          const last = attempt === attempts - 1;
          try {
            const response = await timedFetch(url, init);
      // 最后一次尝试无论结果如何都交回调用方：5xx 响应体里有服务端错误原文，
      // 直接 new Error('HTTP 503') 会把它丢掉。
            if (!idempotent || response.status < 500 || last) return response;
          } catch (error) {
            if (last) throw error;
          }
        }
      // 循环里每次都以 return 或 throw 结束，这一行只是给静态检查一个收敛点。
        throw new Error(`HTTP 请求失败：${method} ${url}`);
      }

      /** 同一份变更在途时重复点击不再发第二条请求：key 带上整个 body。
       * 只按 action 去重会把「开关 A 在途、用户又点了开关 B」这条真变更当成重复丢掉。 */
      const inflightCommands = new Map();

      /** @param {object} body @returns {Promise<object>} */
      async function command(body) {
        const key = `${body && body.action}\u0000${JSON.stringify(body)}`;
        const running = inflightCommands.get(key);
        if (running) return running;
        const started = (async () => {
          const response = await requestWithRetry(COMMAND_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok) throw new Error((payload && payload.error) || `HTTP ${response.status}`);
          return payload;
        })();
        inflightCommands.set(key, started);
        const release = () => inflightCommands.delete(key);
        started.then(release, release);
        return started;
      }

      /** @returns {Promise<object>} 宿主侧当前状态。 */
      async function fetchState() {
        const response = await requestWithRetry(STATE_URL, { headers: { accept: 'application/json' } });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error((payload && payload.error) || `HTTP ${response.status}`);
        return payload;
      }

      exports.timedFetch = timedFetch;
      exports.requestWithRetry = requestWithRetry;
      exports.inflightCommands = inflightCommands;
      exports.command = command;
      exports.fetchState = fetchState;

    });

    __define("./react.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // React 与 h：整个客户端只在这里 require 一次 react。

      const React = require('react');

      const h = React.createElement;

      exports.React = React;
      exports.h = h;

    });

    __define("./tokens.js", (exports, __load) => {
      // 全插件唯一的样式定义处。
      // 规则：除本文件外，src/client 源文件里不许出现颜色字面量（#rrggbb / rgba(...)），
      // 也不许用 currentColor 当边框色 —— 由 tests/plugin/style-tokens.test.mjs 钉住。
      // 颜色字面量只许出现在这里；分两层：T = 官方设计令牌 --dsw-*（宿主 theme 注入），
      // 其余零散常量（如自绘下拉箭头）也收在本文件。

      // 声明一律写成普通 const/function，文件末尾一条 export { … } 列出对外符号（构建器只认这个子集）。

      /** 取一个官方令牌。令牌缺失时浏览器会丢掉整条声明，所以关键的几个带 fallback。 */
      const token = (name, fallback) => (fallback ? `var(--dsw-${name}, ${fallback})` : `var(--dsw-${name})`);

      /** 字号阶梯 —— 全插件唯一的五个字号（15/13/12/11/10），语义按用途分
       *   lg = 15 统计数字那种要突出的
       *   md = 13 正文基准（根节点就是它，标题、输入框、二级字都对齐到这档）
       *   sm = 12 辅助说明、按钮、等宽代码块
       *   xs = 11 更小的注释（时间线、脚注）
       *   xxs = 10 徽标那种点缀
       * 数值变了语义不变。 */
      const FONT = { lg: 15, md: 13, sm: 12, xs: 11, xxs: 10 };

      /** 页面几何范式 —— 全插件唯一的间距 / 行参数。
       * 间距只有三档：8 组内 / 12 块内 / 20 块间。
       * 「行」是面板的基本单元：[内容 | 开关列] 两列网格，缩进按级算，
       * 一级正好一个 ▸ 的宽度（13px 系统字体实测 15.6px → 取 16），
       * 所以没有箭头的二级行文字与有箭头的标题文字起在同一条竖线上。 */
      const LAYOUT = {
        gapLine: 8, // 行内：标签→输入框、同一组里相邻两行
        gapBlock: 12, // 块内：同一块里的字段之间
        gapSection: 20, // 块间：角色列表 / 设置 / 能力行 这些大块之间
        row: {
          gap: 8, // 行里两列之间的间距（内容 ↔ 右侧开关列）
          padX: 6, // 行左右内边距
          padY: 4, // 普通行上下内边距（相邻两行的文字间距 = gapLine，由这里的上下内边距凑出来）
          headPadY: 5, // 带底色的标题行上下内边距（比普通行多 1px）
          indent: 16, // 每缩进一级 = 一个 ▸ 箭头的宽度
          toggle: 90, // 右侧「整类 / 单个」开关列宽
        },
        // 「可点的一行」（角色列表那种），比能力行的行略胖。
        item: { padX: 8, padY: 6 },
      };

      const T = {
        // 文字
        labelPrimary: token('alias-label-primary'),
        labelSecondary: token('alias-label-secondary'),
        labelTertiary: token('alias-label-tertiary'),
        // 线（l1 最淡 → l4 最重：实测浅色主题为 5% / 10% / 12% / 16% 黑）
        border: token('alias-border-l4'), // 输入框那档
        borderSoft: token('alias-border-l2'), // 分隔线那档
        divider: token('alias-border-l3'),
        // 面
        fieldBg: token('alias-bg-layer-3'),
        chipBg: token('alias-bg-layer-2'),
        hoverBg: token('alias-interactive-bg-hover'),
        // 状态
        focusBorder: token('alias-state-business-primary'),
        error: token('alias-state-error-primary', '#f2645a'),
        // 圆角（官方四档：4 / 8 / 12 / 16）
        radiusXs: token('radius-xs'),
        radiusSm: token('radius-sm'),
        radiusMd: token('radius-md'),
        radiusLg: token('radius-lg'),
        fontFamily: token('font-family'),
        // 字号阶梯（见上）
        font: FONT,
        // 间距与行的几何范式（见上）
        layout: LAYOUT,
      // 官方输入框那一套，逐条对齐 fields.module.css 的 .input。
      // 重点是 font: inherit：原生 input / select / textarea 不继承字体，
      // 这正是同一个面板里标签和输入框字号字重不一致的根因。
        field: {
          height: 34,
          padding: '0 12px',
          border: `0.5px solid ${token('alias-border-l4')}`,
          borderRadius: token('radius-md'),
          background: token('alias-bg-layer-3'),
          font: 'inherit',
          fontSize: FONT.md,
          lineHeight: 1.5,
          color: token('alias-label-primary'),
        },
        // 官方工具栏按钮那档：无填充、细边、圆角 sm。
        button: {
          border: `1px solid ${token('alias-border-l3')}`,
          background: 'transparent',
          color: 'inherit',
          borderRadius: token('radius-sm'),
          font: 'inherit',
          fontSize: FONT.sm,
          cursor: 'pointer',
        },
      };

      /** 自绘下拉框的箭头（内嵌 svg）：appearance:none 之后原生箭头会消失，靠这张图补回来。 */
      const caretImage =
        "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M1.5 3.75L5 7.25l3.5-3.5' fill='none' stroke='%23808080' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";

      exports.T = T;
      exports.caretImage = caretImage;

    });

    __define("./styles.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 颜色 / 圆角 / 字体不写字面量：全部来自 tokens.js（官方 --dsw-* 令牌），由测试钉住。

      const { T, caretImage } = __load('./tokens.js');

      // 字号与几何只从 tokens.js 取：F = 字号五档（15/13/12/11/10），L = 三档间距 + 行几何。
      const F = T.font;
      const L = T.layout;

      /** 「行」的范式：[内容 | 开关列] 两列网格。
       * level = 缩进级数（1 = 二级行，缩进一个 ▸ 宽，与标题文字对齐）。
       * 要调整行高 / 缩进 / 开关列宽，只改 T.layout。 */
      const rowStyle = (level = 0, extra = {}) => {
      // padY 是唯一允许在范式默认值上覆盖的数字（带底色的标题行要 headPadY），
      // 其余一律从 L.row 取，测试才能直接断言整条 padding 简写。
        const { padY = L.row.padY, ...rest } = extra;
        return {
          display: 'grid',
          gridTemplateColumns: `1fr ${L.row.toggle}px`,
          gap: L.row.gap,
          alignItems: 'center',
          padding: `${padY}px ${L.row.padX}px ${padY}px ${L.row.padX + level * L.row.indent}px`,
          borderRadius: T.radiusSm,
          ...rest,
        };
      };

      // 面板的壳：root 管纵向排布，page 再加页签页的宽度与位置。
      // 宽度照抄官方输入框卡片那对变量（clearance 16px / 卡片上限 712px），两块盒子逐像素相同。
      // 不许自己算 64%：参照系会变成 viewArea 而不是会话列，面板会宽出 89px、上下对不齐。
      const rootBox = { display: 'flex', flexDirection: 'column', gap: L.gapSection, fontSize: F.md, color: 'inherit' };
      const pageBox = {
        width: 'calc(100% - 2 * var(--dsh-composer-side-clearance, 16px))',
        maxWidth: 'var(--dsh-composer-card-max-width, 712px)',
        margin: '0 auto',
        padding: '16px 0 24px',
        boxSizing: 'border-box',
      };

      const styles = {
        root: { ...rootBox },
        page: { ...rootBox, ...pageBox },
        hint: { opacity: 0.7, fontSize: F.sm, lineHeight: 1.6 },
        row: { display: 'flex', gap: L.gapLine, alignItems: 'center', flexWrap: 'wrap' },
        button: {
          padding: '4px 10px',
          borderRadius: T.radiusSm,
          border: T.button.border,
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          fontSize: F.sm,
        },
        danger: { color: T.error },
      // 输入框统一走官方那一套（T.field：0.5px 细边 + radius-md + font: inherit）。
        input: { ...T.field, minWidth: 180 },
      // 横排里的输入框：flex 吃掉剩余宽度，否则只剩 180px。
        inputGrow: { ...T.field, minWidth: 180, flex: '1 1 180px' },
      // 下拉框：官方输入框的壳 + 自绘箭头（appearance:none 之后原生箭头会消失）。
        select: {
          ...T.field,
          appearance: 'none',
          WebkitAppearance: 'none',
          outline: 'none',
          paddingRight: 22,
          backgroundImage: caretImage,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 8px center',
          backgroundSize: '10px 10px',
          minWidth: 180,
        },
      // 「角色列表」一整块（一个角色一行）与「这个角色的全部设置」都撑满上限宽度。
      // 不做左右两列：窗口一拉宽就并排、左列几个角色就结束、下面留一大块空白。
        columns: { display: 'flex', flexDirection: 'column', gap: L.gapSection },
        roles: { display: 'flex', flexDirection: 'column', gap: L.gapLine },
        roleItem: {
          textAlign: 'left',
          padding: `${L.item.padY}px ${L.item.padX}px`,
          borderRadius: T.radiusSm,
      // 必须与 roleItemActive 同用长写属性：简写 + 只覆盖 borderColor 会让失去选中的那行留下黑框。
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: 'transparent',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          fontSize: F.sm,
        },
        roleItemActive: { borderColor: T.border, background: T.chipBg },
      // 这一整块纵向排、整宽。没有 flex: 1 1 420px：外壳纵向之后它变成「高度至少 420」。
        detail: { display: 'flex', flexDirection: 'column', gap: L.gapBlock },
        field: { display: 'flex', flexDirection: 'column', gap: L.gapLine },
      // 字段标题统一一份，对齐官方 fields.module.css 的 .label（13px / 500 / 1.5 / label-primary）。
        label: { fontSize: F.md, fontWeight: 500, lineHeight: 1.5, color: T.labelPrimary },
      // 标题 + ⓘ 同一行：挂在标签 span 自己身上，不包一层 div（夹具按 div > span + input 找输入框）。
        labelInline: { display: 'inline-flex', alignItems: 'center', gap: 4 },
      // 层级标题：加粗 + 稍放大 + 一条分隔线，跟下面的字段拉开距离。
        sectionHeader: {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 0 5px',
          marginTop: 2,
          borderBottom: `1px solid ${T.borderSoft}`,
        },
        sectionTitle: { fontSize: F.md, fontWeight: 700, letterSpacing: '0.02em' },
      // 配置说明收进这个圆点：鼠标放上去（title）才展开。
        info: {
          flex: '0 0 auto',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          borderRadius: '50%',
          border: `1px solid ${T.border}`,
          opacity: 0.55,
          fontSize: F.xxs,
          lineHeight: 1,
          fontStyle: 'italic',
          cursor: 'help',
          userSelect: 'none',
        },
      // 列表 gap = gapLine - 2×padY：行与行文字的间距就是范式里的 gapLine。
        table: { display: 'flex', flexDirection: 'column', gap: L.gapLine - 2 * L.row.padY },
      // 普通行 / 二级行（level:1）：二级行缩进一级，跟标题文字对齐。
        line: rowStyle(0),
        child: rowStyle(1),
      // 分组行：普通行的底 + 灰底 + 加粗（能力行里「ego（33 个）」那些）。
        lineStrong: rowStyle(0, { fontWeight: 600 }),
      // 带底色的标题行：跟分组行同宽同列，这样「整类 / 全部开关」的复选框正好在同一列。
        lineGroup: rowStyle(0, {
          padY: L.row.headPadY,
          background: T.chipBg,
          fontWeight: 600,
        }),
      // MCP 那一行（McpPanel 的标题）与上面的分组行同一层，长得一样。
        panelHeader: rowStyle(0, {
          padY: L.row.headPadY,
          background: T.chipBg,
          fontWeight: 600,
        }),
        groupToggle: {
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          textAlign: 'left',
          padding: 0,
          border: 'none',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          font: 'inherit',
          fontWeight: 600,
        },
      // 覆盖标记画真正的左边框，不用 boxShadow inset：行有 5px 圆角，内阴影会顺着圆角绕成「{」形。
      // 左侧两个圆角压平，笔画才是直的。
        lineOverride: {
          borderLeft: `2px solid ${T.divider}`,
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
        },
      // 二级行的名字：字号 = 正文基准、不加粗、不用等宽字体
      // （等宽在 Windows 会落到 Courier New，同 13px 也显得又小又细）。
        id: { fontSize: F.md },
        badge: { fontSize: F.xxs, opacity: 0.6, textAlign: 'right' },
        pre: {
          margin: 0,
          padding: 8,
          borderRadius: T.radiusSm,
          background: T.chipBg,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: F.xs,
          whiteSpace: 'pre-wrap',
          overflowX: 'auto',
        },
        textarea: {
          width: '100%',
          minHeight: 90,
          padding: 8,
          borderRadius: T.radiusMd,
          border: `0.5px solid ${T.border}`,
          background: T.fieldBg,
          color: 'inherit',
          font: 'inherit',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: F.sm,
        },
        error: { color: T.error, fontSize: F.sm, whiteSpace: 'pre-wrap' },
      };

      exports.styles = styles;

    });

    __define("./notes.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // notes.json 说明文案层（说明是数据，不是字面量）。

      const { h } = __load('./react.js');
      const { styles } = __load('./styles.js');

      /** 说明文案是查表，不是字面量：宿主侧每次 /state 读 notes.json（与 roles.json 同级），
       * 把合并后的映射作为 notes.values 下发；这里的字符串只是映射里没有那个键时的兜底。
       * 改一行 json 就能改面板文案，不用重启、不用改代码。 */
      let noteValues = {};
      const describe = (key, fallback, args) => {
        const raw = typeof noteValues[key] === 'string' && noteValues[key].length > 0 ? noteValues[key] : fallback;
        if (typeof raw !== 'string') return '';
        if (args === undefined) return raw;
        return raw.replace(/\{(\w+)\}/g, (match, name) => (name in args ? String(args[name]) : match));
      };

      /** 「其它的配置说明用悬浮显示」：每条说明都收在 ⓘ 里，它的 title 就是文本。
       * 故意用原生 tooltip：不占状态、不用 portal，面板在指针下重渲染也不会卡住展开。
       * extra 是运行时才算得出的那几句（例如当前模式来自哪），必须接在解析后的说明后面，不能塞进 fallback。 */
      const info = (key, fallback, args, extra) => {
        const text = note(describe(key, fallback, args), extra);
        return h('span', { style: styles.info, title: text, 'aria-label': text, role: 'img' }, 'i');
      };
      /** 拼说明的各段，丢掉空的。 */
      const note = (...parts) => parts.filter((part) => typeof part === 'string' && part.length > 0).join('\n');
      /** 每个配置块一个醒目标题；说明收进 ⓘ（见 info）。 */
      const section = (title, key, fallback, args, extra) =>
        h(
          'div',
          { style: styles.sectionHeader },
          h('span', { style: styles.sectionTitle }, title),
          typeof fallback === 'string' && fallback.length > 0 ? info(key, fallback, args, extra) : null,
        );

      const setNoteValues = (next) => {
        noteValues = next;
      };

      exports.noteValues = noteValues;
      exports.describe = describe;
      exports.info = info;
      exports.note = note;
      exports.section = section;
      exports.setNoteValues = setNoteValues;

    });

    __define("./section/team-roles-core.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 容器第 1 段：状态、错误、加载、adopt/run/refresh。

      const { ERROR_TTL_MS, nakedMemberName } = __load('./constants.js');
      const { command, fetchState } = __load('./net.js');
      const { setNoteValues } = __load('./notes.js');
      const { React } = __load('./react.js');

      function useTeamRolesCore() {
        const [state, setState] = React.useState(null);
        const [error, setError] = React.useState('');
        const [busy, setBusy] = React.useState(false);
        const [selectedId, setSelectedId] = React.useState(null);
        const [name, setName] = React.useState('');
        const [description, setDescription] = React.useState('');
        const [order, setOrder] = React.useState('10');
        const [newName, setNewName] = React.useState('');
      /** 新建角色那一行里填的 id（空串表示自动）。 */
        const [newId, setNewId] = React.useState('');
      /** 选中角色后也能改 id：存裸成员名（id 去掉 team- 前缀），与新建那一行同一种写法；
       * 保存时 update-role 收 newId，宿主把目录、role.json 与注册的 preset 一起换。 */
        const [idDraft, setIdDraft] = React.useState('');
      // 「全开 / 全关」没有单独的 bulk 覆盖状态：与单个开关走同一套乐观覆盖，整组勾选框点下去就变。
      /** 最近一次 set-team 的结果，避免「需要重启」被静默丢掉。 */
        const [teamResult, setTeamResult] = React.useState(null);
      /** 「哪个角色的哪些字段是用户改过、还没保存的草稿」。
       * 每次 /state 回包都会造一批新的 role 对象；同步 effect 若依赖 selected 这个对象，
       * 对象换新就会重跑，把用户正在打的字换成磁盘旧值。所以按字段记，而不是按角色记。
       * 形状 `{ id, fields: { name?, description?, order?, id? } }`。 */
        const [dirty, setDirty] = React.useState(null);
      /** 失败提示的计时器；错误不再靠 refresh 顺手清掉。 */
        const errorTimer$ = React.useRef(null);
        const clearError = React.useCallback(() => {
          if (errorTimer$.current !== null) {
            clearTimeout(errorTimer$.current);
            errorTimer$.current = null;
          }
          setError('');
        }, []);
        const showError = React.useCallback((message) => {
          if (errorTimer$.current !== null) clearTimeout(errorTimer$.current);
          setError(message);
          errorTimer$.current = setTimeout(() => {
            errorTimer$.current = null;
            setError('');
          }, ERROR_TTL_MS);
        }, []);
      // 面板卸载时别把计时器留在后台。
        React.useEffect(
          () => () => {
            if (errorTimer$.current !== null) clearTimeout(errorTimer$.current);
          },
          [],
        );
      /** 逐控件的「进行中」集合：一个开关只让自己 pending，一次点击不会让整张表变灰。 */
        const [pending, setPending] = React.useState(() => new Set());
      /** 乐观覆盖：点下去立刻按目标状态画，回包之后再以 /state 为准。
       * 宿主回包要重同步每个角色的预设，慢到勾选框只在回包后才动会像坏了一样。 */
        const [draft, setDraft] = React.useState(null);
      /** 一次手势 = 一个请求（客户端这一半）：每次开关变更先入队，
       * SWITCH_BURST_MS 后并成一个 set-switches，五次快速点击只走一次回包、只重建一次。 */
        const queue = React.useRef({ roleId: null, rows: {}, mcp: {}, tools: {}, keys: new Set(), timer: null });
      /** run 定义在前面却要用 flushSwitches：这个 ref 单向补齐，填上之后才会被调用。 */
        const flushSwitches$ = React.useRef(null);
      /** 技能列表的队列用同一个单向门。 */
        const flushSkills$ = React.useRef(null);

        const selected = state === null ? null : state.roles.find((role) => role.id === selectedId) || null;

        const adopt = React.useCallback((next, keepSelection) => {
      // 说明表随每次 state 回包下发，刷新就够拾起改过的 notes.json。
          setNoteValues((next.notes && next.notes.values) || {});
          setState(next);
          setSelectedId((current) => {
            if (keepSelection && next.roles.some((role) => role.id === current)) return current;
            return next.roles.length > 0 ? next.roles[0].id : null;
          });
        }, []);

      /** 刷新的期号：慢的那次 refresh 后回来时不能盖掉更新的结果，号码过期就丢弃。 */
        const refreshTicket$ = React.useRef(0);

        const run = React.useCallback(
          async (body, options) => {
      // quiet 给自带乐观覆盖的控件（上下文面板的 provider 开关）用。
      // 结构性动作（新建/删除/还原/改模式/团队开关）仍拿全局锁：它们进行中整个面板都是未知状态。
            const quiet = options !== undefined && options.quiet === true;
      // 排队中的开关批次改的是同一个角色，必须先落地，否则会盖在之后的还原上面。
            if (flushSwitches$.current !== null) await flushSwitches$.current();
      // 排队中的技能选择也改同一个 role.json，同样先落地。
            if (flushSkills$.current !== null) await flushSkills$.current();
            if (!quiet) setBusy(true);
            clearError();
            try {
              const payload = await command(body);
              if (payload && payload.state) {
      // 这条命令的回包比任何在途 refresh 都新，先把它们作废。
                refreshTicket$.current += 1;
                adopt(payload.state, true);
              }
              clearError();
              return payload;
            } catch (failure) {
              showError(String((failure && failure.message) || failure));
              return null;
            } finally {
              if (!quiet) setBusy(false);
            }
          },
          [adopt, clearError, showError],
        );

        const refresh = React.useCallback(async () => {
      // 领号：只有这一趟仍是最新时，回包才允许落地。
          const ticket = refreshTicket$.current + 1;
          refreshTicket$.current = ticket;
          try {
            const payload = await fetchState();
            if (refreshTicket$.current !== ticket) return;
            adopt(payload, true);
      // 不能无条件 setError('')：任何成功的刷新都会把刚失败的提示抹掉（提示只活约 43ms），
      // 错误由 showError 计时，这里不动它。
          } catch (failure) {
      // 过期的失败同样不该弹提示：用户看到的那一屏早就不对应这个状态。
            if (refreshTicket$.current !== ticket) return;
            showError(String((failure && failure.message) || failure));
          }
        }, [adopt, showError]);

        React.useEffect(() => {
          void refresh();
        }, [refresh]);

      /** 这个角色的哪些字段已经有草稿。markDirty 只加不覆盖，且必须定义在 selected 之后。 */
        const markDirty = (field) => {
          setDirty((current) => {
            if (selected === null) return current;
            const fields = current !== null && current.id === selected.id ? current.fields : {};
            if (fields[field] === true) return current;
            return { id: selected.id, fields: { ...fields, [field]: true } };
          });
        };
        const clearDirty = () => setDirty(null);
        const isDirty = (field) =>
          dirty !== null && selected !== null && dirty.id === selected.id && dirty.fields[field] === true;

      /** 上一次把服务端值写进 id 框时那个角色的完整 id，只在同步 effect 真正写表单时更新。 */
        const idBaseline$ = React.useRef(null);
      /** 同步 effect 刚写过 id 框：这一笔是同步来的，不是用户敲的。
       * 必须用标记而不是比较 idDraft 与基线：同步那一帧 idDraft 还是上一帧的值，
       * 光靠比较会把挂载时的一次同步误判成用户编辑。 */
        const idSyncPending$ = React.useRef(false);
        React.useEffect(() => {
          if (selected === null) return;
      // 改过的字段不覆盖，没碰过的字段照常跟服务端走。
          if (!isDirty('name')) setName(selected.name || '');
          if (!isDirty('description')) setDescription(selected.description || '');
          if (!isDirty('order')) setOrder(String(selected.order ?? 10));
      // 详情里的 id 框显示裸成员名（与新建那一行同一种写法）。
          const prefix =
            state && typeof state.presetPrefix === 'string' && state.presetPrefix.length > 0
              ? state.presetPrefix
              : 'team-';
          idBaseline$.current = selected.id;
          if (!isDirty('id') && idDraft !== nakedMemberName(selected.id, prefix)) {
            idSyncPending$.current = true;
            setIdDraft(selected.id.startsWith(prefix) ? selected.id.slice(prefix.length) : selected.id);
          }
      // 依赖全是原始值：role 对象每次回包都是新引用，但服务端值没变时不该重填表单。
        }, [
          selected === null ? null : selected.id,
          selected === null ? '' : selected.name || '',
          selected === null ? '' : selected.description || '',
          selected === null ? 10 : selected.order ?? 10,
          state === null ? 'team-' : state.presetPrefix,
          dirty,
        ]);

      /** 切换角色必须一次提交做完：清草稿、换选中项、填新角色的服务端值。
       * 只 setSelectedId 的话，填表要等绘制之后的同步 effect，中间那一帧是新角色配旧值，
       * 红字会闪一下把下面的内容顶下去。一次事件里把状态全下完，React 只提交一帧。 */
        const selectRole = (roleId) => {
          const next = ((state === null ? null : state.roles) || []).find((role) => role.id === roleId) || null;
          setDirty(null);
          setSelectedId(roleId);
          if (next === null) return;
          setName(next.name || '');
          setDescription(next.description || '');
          setOrder(String(next.order ?? 10));
          const prefix =
            state && typeof state.presetPrefix === 'string' && state.presetPrefix.length > 0
              ? state.presetPrefix
              : 'team-';
      // 基线先写好：idDraft 那个 effect 拿基线比对，这一笔不会被误判成用户编辑。
          idBaseline$.current = next.id;
          setIdDraft(nakedMemberName(next.id, prefix));
        };

      // 名字 / 描述 / 排序三个框走 editDraft，一改就按字段标脏。
        return {
          adopt,
          busy,
          clearDirty,
          clearError,
          description,
          dirty,
          draft,
          error,
          errorTimer$,
          flushSkills$,
          flushSwitches$,
          idBaseline$,
          idDraft,
          idSyncPending$,
          isDirty,
          markDirty,
          name,
          newId,
          newName,
          order,
          selectRole,
          pending,
          queue,
          refresh,
          refreshTicket$,
          run,
          selected,
          selectedId,
          setBusy,
          setDescription,
          setDirty,
          setDraft,
          setError,
          setIdDraft,
          setName,
          setNewId,
          setNewName,
          setOrder,
          setPending,
          setSelectedId,
          setState,
          setTeamResult,
          showError,
          state,
          teamResult,
        };
      }

      exports.useTeamRolesCore = useTeamRolesCore;

    });

    __define("./section/team-roles-drafts.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 容器第 2 段：字段草稿、dirty 基线、displayRole。

      const { nakedMemberName } = __load('./constants.js');
      const { React } = __load('./react.js');

      function useTeamRolesDrafts(core) {
        const { draft, idBaseline$, idDraft, idSyncPending$, markDirty, selected, setDraft, setPending, state } = core;
        const editDraft = (field, setter) => (event) => {
          setter(event.target.value);
          markDirty(field);
        };

      /** 角色 ID 框不能改 onChange 的写法：必须保持
       * `onChange: (event) => setIdDraft(event.target.value)`（有源码形状断言在盯着）。
       * 脏判定改成「与同步时记下的基线比」：idDraft 一旦偏离 idBaseline$，就说明是用户敲的。
       * 依赖只放 [idDraft]：切角色时上一帧先写好基线，下一帧 idDraft 才变，
       * 那一帧靠 idSyncPending$ 放行，不会误判成 dirty。 */
        React.useEffect(() => {
          if (idSyncPending$.current) {
            idSyncPending$.current = false;
            return;
          }
          if (idBaseline$.current === null) return;
          const prefix =
            state && typeof state.presetPrefix === 'string' && state.presetPrefix.length > 0
              ? state.presetPrefix
              : 'team-';
          if (idDraft === nakedMemberName(idBaseline$.current, prefix)) return;
          markDirty('id');
        }, [idDraft]);

      /** 带乐观覆盖的开关，覆盖写在这份 overlay 里。
       * writeDraft 合并补丁；值为 undefined 表示**丢掉**这个键（回包已到，/state 才是真相）。 */
        const markPending = React.useCallback((key, on) => {
          setPending((current) => {
            const next = new Set(current);
            if (on) next.add(key);
            else next.delete(key);
            return next;
          });
        }, []);

      /** 写入某个角色的乐观覆盖。
       * keepOtherRole 给回包路径用：用户已经切走，迟到的 set-switches 回包不能复活或抹掉别的角色的覆盖；
       * 用户手势照旧接管草稿，因为他看的就是眼前这个角色。 */
        const writeDraft = React.useCallback((roleId, patch, options) => {
          const keepOtherRole = options !== undefined && options.keepOtherRole === true;
          setDraft((current) => {
            if (keepOtherRole && current !== null && current.roleId !== roleId) return current;
            const base =
              current !== null && current.roleId === roleId
                ? current
                : { roleId, rows: {}, mcp: {}, tools: {}, config: {}, skills: {} };
            const merged = {};
            for (const field of ['rows', 'mcp', 'tools', 'config', 'skills']) {
              const next = { ...base[field] };
              for (const [key, value] of Object.entries(patch[field] || {})) {
                if (value === undefined) delete next[key];
                else next[key] = value;
              }
              merged[field] = next;
            }
            return { roleId, ...merged };
          });
        }, []);

      // 面板实际渲染的：选中角色 + 本会话还没确认的翻转叠在上面，其余都来自 /state。
        const displayRole = React.useMemo(() => {
          if (selected === null || draft === null || draft.roleId !== selected.id) return selected;
          const rows = selected.rows.map((row) => {
            const hasDisabled = Object.prototype.hasOwnProperty.call(draft.rows, row.id);
            const hasConfig = Object.prototype.hasOwnProperty.call(draft.config, row.id);
            if (!hasDisabled && !hasConfig) return row;
            const next = { ...row };
            if (hasDisabled) {
              next.disabled = draft.rows[row.id];
              next.hasOverride =
                row.hasOverride === true || row.templateDisabled !== next.disabled;
            }
            if (hasConfig) {
              const config = { ...(row.config || {}) };
              for (const [key, value] of Object.entries(draft.config[row.id])) {
                if (value === null) delete config[key];
                else config[key] = value;
              }
              next.config = config;
              next.hasOverride = true;
            }
            return next;
          });
          const capabilities = { ...(selected.capabilities || {}) };
          if (Object.keys(draft.mcp).length > 0) {
            const mcp = capabilities.mcp || {};
            const deny = new Set(mcp.deny || []);
            for (const [server, enabled] of Object.entries(draft.mcp)) {
              if (enabled) deny.delete(server);
              else deny.add(server);
            }
            capabilities.mcp = { ...mcp, deny: [...deny] };
          }
      // 插件可见性的同款乐观覆盖：勾掉一个工具就按目标名单画，
      // 不等宿主侧回包（回包后 overlay 被 drop，/state 才是真相）。
          const toolsDraft = draft.tools || {};
          if (Object.keys(toolsDraft).length > 0) {
            const toolGate = capabilities.toolGate || {};
            const deny = new Set(toolGate.deny || []);
            for (const [name, enabled] of Object.entries(toolsDraft)) {
              if (enabled) deny.delete(name);
              else deny.add(name);
            }
            capabilities.toolGate = { ...toolGate, deny: [...deny] };
          }
      // 技能名单的乐观覆盖：点下去就按目标名单画。
      // dirs 用 /state 里那份可用技能表反查，提示行「现在挂着 N 个技能目录」也立刻跟着变。
          const skillsDraft = draft.skills || {};
          if (Object.keys(skillsDraft).length > 0) {
            const skills = { ...(selected.skills || {}) };
            if (Object.prototype.hasOwnProperty.call(skillsDraft, 'mode')) skills.mode = skillsDraft.mode;
            if (Object.prototype.hasOwnProperty.call(skillsDraft, 'ids')) {
              const ids = skillsDraft.ids || [];
              const available = ((state === null ? null : state.skills) || {}).available || [];
              const byName = new Map(available.map((skill) => [skill.name, skill]));
              skills.ids = ids;
              skills.dirs = ids
                .map((name) => (byName.get(name) || {}).dir)
                .filter((dir) => typeof dir === 'string');
            }
            return { ...selected, rows, capabilities, skills };
          }
          return { ...selected, rows, capabilities };
        }, [selected, draft, state]);

      /** 队列，以及它最终变成的那一条请求
       * 把堆起来的变更合成一条声明式 set-switches（宿主侧一次写盘、一次重建预设），
       * 回包后只 drop 本次携带的键 —— 回包到达时用户可能已经又点了新的。
       * 失败时草稿要被退回，否则界面会停在没写进磁盘的状态上。 */
        return {
          displayRole,
          editDraft,
          markPending,
          writeDraft,
        };
      }

      exports.useTeamRolesDrafts = useTeamRolesDrafts;

    });

    __define("./section/team-roles-switches.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 容器第 3 段：开关 burst 队列与提交。

      const { SKILL_BURST_MS, SWITCH_BURST_MS } = __load('./constants.js');
      const { command } = __load('./net.js');
      const { React } = __load('./react.js');

      function useTeamRolesSwitches(core, drafts) {
        const { adopt, clearError, error, flushSkills$, flushSwitches$, queue, refresh, selectedId, showError, state } = core;
        const { markPending, writeDraft } = drafts;
        const flushSwitches = React.useCallback(async () => {
          const batch = queue.current;
          if (batch.timer !== null) clearTimeout(batch.timer);
      // 同步取出：commitSwitches 先 flush 再立刻开始填下一批，所以不能 async。
          queue.current = { roleId: null, rows: {}, mcp: {}, tools: {}, keys: new Set(), timer: null };
          if (batch.roleId === null || batch.keys.size === 0) return undefined;

          const drop = { rows: {}, mcp: {}, tools: {} };
          for (const rowId of Object.keys(batch.rows)) drop.rows[rowId] = undefined;
          for (const server of Object.keys(batch.mcp)) drop.mcp[server] = undefined;
          for (const name of Object.keys(batch.tools)) drop.tools[name] = undefined;

          try {
            const payload = await command({
              action: 'set-switches',
              id: batch.roleId,
              rows: batch.rows,
              mcp: batch.mcp,
              tools: batch.tools,
            });
            for (const key of batch.keys) markPending(key, false);
            writeDraft(batch.roleId, drop, { keepOtherRole: true });
      // 成功就把上一次失败留下的提示收掉（失败提示由 showError 计时）。
            clearError();
            if (payload && payload.state) adopt(payload.state, true);
            else await refresh();
          } catch (failure) {
            showError(String((failure && failure.message) || failure));
            for (const key of batch.keys) markPending(key, false);
            writeDraft(batch.roleId, drop, { keepOtherRole: true });
            await refresh();
          }
          return undefined;
        }, [adopt, clearError, markPending, refresh, showError, writeDraft]);
        React.useEffect(() => {
          flushSwitches$.current = flushSwitches;
        }, [flushSwitches]);

      /** 开关唯一的变更入口：先画（draft）、记进队列、开 burst 计时，
       * 全过程不 await 请求 —— 勾选框才能跟手。 */
        const commitSwitches = (patch, keys) => {
      // 用户切到别的角色：先把上一个角色的队列落地。
          if (queue.current.roleId !== null && queue.current.roleId !== selectedId) {
            void flushSwitches();
          }
          const batch = queue.current;
          batch.roleId = selectedId;
          for (const rowId of Object.keys(patch.rows || {})) batch.rows[rowId] = patch.rows[rowId];
          for (const server of Object.keys(patch.mcp || {})) batch.mcp[server] = patch.mcp[server];
          for (const name of Object.keys(patch.tools || {})) batch.tools[name] = patch.tools[name];
          for (const key of keys) batch.keys.add(key);
          writeDraft(selectedId, patch);
          for (const key of keys) markPending(key, true);
          if (batch.timer !== null) clearTimeout(batch.timer);
          batch.timer = setTimeout(() => {
            void flushSwitches();
          }, SWITCH_BURST_MS);
        };

      /** 技能名单的队列，与上面开关同一个形状。
       * 点击先经 draft.skills 画上，只把这一行标 pending，
       * burst 计时器把一串点击并成一次 set-skills —— 点一个技能不会让整张表变灰。 */
        const skillsQueue = React.useRef({ roleId: null, mode: null, ids: null, keys: new Set(), timer: null });

        const flushSkills = React.useCallback(async () => {
          const batch = skillsQueue.current;
          if (batch.timer !== null) clearTimeout(batch.timer);
          skillsQueue.current = { roleId: null, mode: null, ids: null, keys: new Set(), timer: null };
          if (batch.roleId === null || batch.keys.size === 0) return undefined;
          const drop = { skills: { mode: undefined, ids: undefined } };
          try {
            const payload = await command({
              action: 'set-skills',
              id: batch.roleId,
              mode: batch.mode,
              ids: batch.ids,
            });
            for (const key of batch.keys) markPending(key, false);
            writeDraft(batch.roleId, drop, { keepOtherRole: true });
      // 同 flushSwitches：成功即收掉上一次的失败提示。
            clearError();
            if (payload && payload.state) adopt(payload.state, true);
            else await refresh();
          } catch (failure) {
            showError(String((failure && failure.message) || failure));
            for (const key of batch.keys) markPending(key, false);
            writeDraft(batch.roleId, drop, { keepOtherRole: true });
            await refresh();
          }
          return undefined;
        }, [adopt, clearError, markPending, refresh, showError, writeDraft]);
        React.useEffect(() => {
          flushSkills$.current = flushSkills;
        }, [flushSkills]);

      /** 勾技能的入口：先画（draft）、把整个目标列表记进队列、开 burst 计时。
       * keys 是这轮要变灰的行：单选只灰一行，表头勾选与还原键灰全部。 */
        const commitSkills = (next, keys) => {
          if (skillsQueue.current.roleId !== null && skillsQueue.current.roleId !== selectedId) {
            void flushSkills();
          }
          const batch = skillsQueue.current;
          batch.roleId = selectedId;
          batch.mode = next.mode;
          batch.ids = next.ids;
          for (const key of keys) batch.keys.add(key);
          writeDraft(selectedId, { skills: { mode: next.mode, ids: next.ids } });
          for (const key of keys) markPending(key, true);
          if (batch.timer !== null) clearTimeout(batch.timer);
          batch.timer = setTimeout(() => {
            void flushSkills();
          }, SKILL_BURST_MS);
        };

      // 新建行的可选 id：draftRoleId 是完整 preset id（带前缀），
      // draftMemberName 是 spawn_teammate 要用的名字。
        return {
          commitSkills,
          commitSwitches,
          flushSkills,
          flushSwitches,
          skillsQueue,
        };
      }

      exports.useTeamRolesSwitches = useTeamRolesSwitches;

    });

    __define("./section/role-id.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 角色 id 规范化（用户输入 → team-xxx）。

      function roleIdFromInput(value, prefix) {
        const clean = String(value ?? '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-+|-+$/g, '');
        if (clean.length === 0) return '';
        const tag = typeof prefix === 'string' && prefix.length > 0 ? prefix : 'team-';
        return clean.startsWith(tag) ? clean : `${tag}${clean}`;
      }

      exports.roleIdFromInput = roleIdFromInput;

    });

    __define("./section/team-roles-vm.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 容器第 4 段：派生值 + 事件处理器，汇成视图 vm。

      const { roleIdFromInput } = __load('./section/role-id.js');

      function buildTeamRolesVm(core, drafts, switches) {
        const { idDraft, newId, pending, run, selected, selectedId, state } = core;
        const { markPending, writeDraft } = drafts;
        const { commitSwitches } = switches;
        const newRoleIdPrefix =
          typeof state.presetPrefix === 'string' && state.presetPrefix.length > 0 ? state.presetPrefix : 'team-';
        const draftRoleId = roleIdFromInput(newId, newRoleIdPrefix);
        const draftMemberName = draftRoleId.startsWith(newRoleIdPrefix)
          ? draftRoleId.slice(newRoleIdPrefix.length)
          : draftRoleId;

      // 同一个规范化也用在选中角色的 id 输入框上（详情面板，名字下面一行）。
        const selectedIdDraft = roleIdFromInput(idDraft, newRoleIdPrefix);
        const selectedMemberName = selectedIdDraft.startsWith(newRoleIdPrefix)
          ? selectedIdDraft.slice(newRoleIdPrefix.length)
          : selectedIdDraft;
        const idDraftInvalid = idDraft.trim().length > 0 && selectedIdDraft === '';
        const idDraftTaken =
          selectedIdDraft !== '' &&
          selectedIdDraft !== (selected ? selected.id : null) &&
          state.roles.some((role) => role.id === selectedIdDraft);
        const idDraftChanged = selected !== null && selectedIdDraft !== selected.id;

      // 挂载失败是 state.registered 看不出来的唯一一种情况：注册表 register() 无论成败都
      // 返回 disposer，激活失败只体现为 roster 上的 broken 诊断而不抛错。
      // 不读那份 roster，构成有问题的角色会看起来和健康的一样。
        const brokenById = new Map();
        for (const record of state.registry || []) {
          if (record && typeof record.broken === 'string' && record.broken.length > 0) {
            brokenById.set(record.id, record.broken);
          }
        }

      // deferred 一直有兜底，registered 没有：宿主只发得出某些形状时（旧版宿主、
      // 状态拼装中途失败、字段被清空），state.registered.includes(...) 会当场抛错把整个设置面板变白。
      // 口径是：形状不对就当作「不知道」，既不误报未注册，也不白屏；拿到数组才照实判断。
        const deferredIds = Array.isArray(state.deferred) ? state.deferred : [];
        const registeredIds = Array.isArray(state.registered) ? state.registered : null;

      // 来源说明不放在这里：每行「从哪来」的答案见「模式」面板的逐模式提示。
      // 一个开关一个 pending 键：勾一下只灰自己。
      // 而且一个队列：点击立刻画（草稿），变更记进队列，由 burst 定时器并成一条请求。
        const onToggle = (row, enabled) => {
          const key = `row:${row.id}`;
          if (pending.has(key)) return undefined;
          commitSwitches({ rows: { [row.id]: !enabled } }, [key]);
          return undefined;
        };
        const onMcpToggle = (server, enabled) => {
          const key = `mcp:${server}`;
          if (pending.has(key)) return undefined;
          commitSwitches({ mcp: { [server]: enabled === true } }, [key]);
          return undefined;
        };
      // 插件可见性与 MCP 那一格同一条队列、同一个 burst 定时器，点一排工具也只出一条 set-switches。
        const onToolToggle = (name, enabled) => {
          const key = `tool:${name}`;
          if (pending.has(key)) return undefined;
          commitSwitches({ tools: { [name]: enabled === true } }, [key]);
          return undefined;
        };
        const onContextToggle = (inherit) => {
          const key = 'context:tool-subagent';
          if (pending.has(key)) return undefined;
          markPending(key, true);
          writeDraft(selectedId, {
            config: { 'tool-subagent': inherit ? { provider: 'fork' } : { provider: null } },
          });
          return run(
            {
              action: 'set-override',
              id: selectedId,
              row: 'tool-subagent',
              ...(inherit ? { config: { provider: 'fork' } } : { clearConfig: ['provider'] }),
            },
            { quiet: true },
          ).finally(() => {
            markPending(key, false);
            writeDraft(selectedId, { config: { 'tool-subagent': undefined } });
          });
        };
      // 模型的三个字段一起提交：勾掉「指定」= 三个都空，回到跟随模板。
        const onModelSet = (model) => {
          const key = 'model';
          if (pending.has(key)) return undefined;
          markPending(key, true);
          return run({
            action: 'set-model',
            id: selectedId,
            provider: String(model?.provider ?? ''),
            model: String(model?.model ?? ''),
            reasoningEffort: String(model?.reasoningEffort ?? ''),
          }).finally(() => markPending(key, false));
        };
      // 「全开 / 全关」只有分组标题行（以及 MCP 标题行）那个复选框一个入口。
      // 整批只发一条请求：commitSwitches 记进队列，120ms 后合成一条 set-switches，
      // 宿主侧一次写盘、一次重建 —— 不是每行一条 set-override。
        const onBulk = (rows, enabled, category) => {
          const key = `group:${category}`;
          if (pending.has(key)) return undefined;
          const targets = rows.filter((row) => (row.disabled !== true) !== enabled);
          if (targets.length === 0) return undefined;
          const patch = { rows: {} };
          for (const row of targets) patch.rows[row.id] = !enabled;
          commitSwitches(patch, [key]);
          return undefined;
        };
        const onMcpBulk = (enabled) => {
          const key = 'mcp:*';
          if (pending.has(key)) return undefined;
          const services = (state === null || state.mcp === undefined ? null : state.mcp.services) || [];
          const denied = new Set(
            (((selected === null ? null : selected.capabilities) || {}).mcp || {}).deny || [],
          );
          const targets = services.filter((service) => denied.has(service.serverName) === enabled);
          if (targets.length === 0) return undefined;
          const patch = { mcp: {} };
          for (const service of targets) patch.mcp[service.serverName] = enabled === true;
          commitSwitches(patch, [key]);
          return undefined;
        };
      // 「插件」那块的全开 / 全关，同 MCP：一条请求带整批目标状态。
        const onToolBulk = (enabled) => {
          const key = 'tool:*';
          if (pending.has(key)) return undefined;
          const tools = (state === null || state.toolGate === undefined ? null : state.toolGate.tools) || [];
          const denied = new Set(
            (((selected === null ? null : selected.capabilities) || {}).toolGate || {}).deny || [],
          );
          const targets = tools.filter((tool) => denied.has(tool.name) === enabled);
          if (targets.length === 0) return undefined;
          const patch = { tools: {} };
          for (const tool of targets) patch.tools[tool.name] = enabled === true;
          commitSwitches(patch, [key]);
          return undefined;
        };
      // 一个名字前缀组的全开 / 全关：组头与逐行开关写的是同一种东西（精确工具名），
      // 所以一条 set-switches 带整组目标状态，宿主侧一次写盘、一次重建。
        const onToolGroup = (group, names, enabled) => {
          const key = `toolgroup:${group}`;
          if (pending.has(key)) return undefined;
          const denied = new Set(
            (((selected === null ? null : selected.capabilities) || {}).toolGate || {}).deny || [],
          );
          const patch = { tools: {} };
          const keys = [key];
          for (const name of names) {
            if (denied.has(name) === enabled) patch.tools[name] = enabled === true;
            keys.push(`tool:${name}`);
          }
          if (Object.keys(patch.tools).length === 0) return undefined;
          commitSwitches(patch, keys);
          return undefined;
        };

        return {
          ...core,
          ...drafts,
          ...switches,
          brokenById,
          deferredIds,
          draftMemberName,
          draftRoleId,
          idDraftChanged,
          idDraftInvalid,
          idDraftTaken,
          newRoleIdPrefix,
          onBulk,
          onContextToggle,
          onMcpBulk,
          onMcpToggle,
          onModelSet,
          onToggle,
          onToolBulk,
          onToolGroup,
          onToolToggle,
          registeredIds,
          selectedIdDraft,
          selectedMemberName,
        };
      }

      exports.buildTeamRolesVm = buildTeamRolesVm;

    });

    __define("./entries.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 能力表行抽取与过滤（MCP / 技能 / 工具）。

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

      exports.needleMatches = needleMatches;
      exports.mcpEntries = mcpEntries;
      exports.skillEntries = skillEntries;
      exports.toolEntries = toolEntries;
      exports.filterEntries = filterEntries;
      exports.TOOL_GROUP_MIN = TOOL_GROUP_MIN;
      exports.toolPrefix = toolPrefix;
      exports.groupTools = groupTools;

    });

    __define("./panels/context.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 上下文继承面板。

      const { describe, note, section } = __load('./notes.js');
      const { h } = __load('./react.js');
      const { styles } = __load('./styles.js');

      function ContextPanel({ role, busy, onSet }) {
        const row = role.rows.find((item) => item.id === 'tool-subagent');
        if (row === undefined) {
          return h(
            'div',
            { style: styles.field },
            section(
              '上下文继承主会话',
              'contextNoRow',
              `这个模式（${role.modeLabel || role.mode || 'standard'}）里没有 delegation/tool-subagent 这一行，这个角色没有可切换的委派工具。`,
            ),
          );
        }

        const templateProvider = String((row.templateConfig && row.templateConfig.provider) ?? 'spawn');
        const provider = String((row.config && row.config.provider) ?? templateProvider);
        const inherit = provider === 'fork';

        return h(
          'div',
          { style: styles.field },
          section(
            '上下文继承主会话',
            inherit ? 'contextOn' : 'contextOff',
            note(
              describe(
                inherit ? 'contextOn' : 'contextOff',
                inherit
                  ? '开：委派走 fork provider —— 成员带上本会话已结束轮次的上下文。'
                  : '关：委派走 spawn provider —— 成员是全新 Agent，零继承。',
              ),
              describe(
                'contextProvider',
                '（改的是模板里已有的 delegation/tool-subagent 行的 provider：{provider}；工具名不变，还是 subagent）',
                { provider },
              ),
              describe(
                'contextOtherTool',
                '这个角色的 subagent_fork 工具不受影响，模型需要时仍可自己选；这里只决定默认那个 subagent 的继承方式。',
              ),
            ),
          ),
          h(
            'div',
            { style: styles.row },
            h('input', {
              type: 'checkbox',
              disabled: busy,
              checked: inherit,
              title: inherit
                ? '这个角色派出的成员继承本会话已完成的对话'
                : '这个角色派出的成员全新开始，零上下文继承',
              onChange: (event) => onSet(event.target.checked),
            }),
            h('span', null, '成员继承主会话上下文'),
          ),
        );
      }

      /** 「技能也要能单独配置」。前提不成立：预设是内存里的声明，每个角色本来就是它模式的派生副本
       * （buildDefinition），所以什么都不用从安装目录拷出来 —— 预设文件、技能目录都不拷。
       * skill-filesystem 那一行本来就带两个旋钮。 */

      exports.ContextPanel = ContextPanel;

    });

    __define("./panels/grouped-table.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 分组表格（能力表通用表体）。

      const { CATEGORY_LABEL, CATEGORY_ORDER } = __load('./constants.js');
      const { needleMatches } = __load('./entries.js');
      const { describe, section } = __load('./notes.js');
      const { React, h } = __load('./react.js');
      const { styles } = __load('./styles.js');

      function GroupedTable({
        role,
        platform,
        busy,
        pending,
        onToggle,
        onBulk,
        onReset,
        extras,
        panels,
        children,
      }) {
        const [query, setQuery] = React.useState('');
        const [onlyChanged, setOnlyChanged] = React.useState(false);
      // 默认全部折叠：记的是**展开过的**分类集合，所以不用先知道这个角色有哪些分类 —— 没人打开过就折叠。
        const [expanded, setExpanded] = React.useState(() => new Set());
      // 「全开 / 全关」进行中不再整表变灰、也不再一行行跳：目标状态由父层的乐观覆盖（draft）
      // 立刻画出来，所以这里读的就是那个算好的 role（父层传进来的是 displayRole）。
        const effective = (row) => row.disabled !== true;

        const fold = (category) => {
          setExpanded((current) => {
            const next = new Set(current);
            if (next.has(category)) next.delete(category);
            else next.add(category);
            return next;
          });
        };

        const visible = React.useMemo(() => {
          const needle = query.trim().toLowerCase();
          return role.rows.filter((row) => {
            if (onlyChanged && row.hasOverride !== true) return false;
            return needleMatches(needle, `${row.path} ${row.name || ''}`);
          });
        }, [role.rows, query, onlyChanged]);

        const grouped = React.useMemo(() => {
          const map = new Map();
          for (const row of visible) {
      // 旧版宿主还用自己那套 identity 维度给 persona 打标签：要归一化，
      // CATEGORY_ORDER 里没有的分类会把整行丢掉。
            const raw = row.category === 'identity' ? 'agents-md' : row.category;
            const key = CATEGORY_LABEL[raw] === undefined ? 'other' : raw;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(row);
          }
          return CATEGORY_ORDER.filter((key) => map.has(key)).map((key) => [key, map.get(key)]);
        }, [visible]);

      // 分类标题后的数字数的是这一类整体的行数，不是过滤后的
      // 不过滤写总数，被过滤掉一部分时写「显示 3 / 共 19」。
        const totals = React.useMemo(() => {
          const map = new Map();
          for (const row of role.rows) {
            const raw = row.category === 'identity' ? 'agents-md' : row.category;
            const key = CATEGORY_LABEL[raw] === undefined ? 'other' : raw;
            map.set(key, (map.get(key) || 0) + 1);
          }
          return map;
        }, [role.rows]);

        if (role.invalid === true) {
          return h('div', { style: styles.error }, '这个角色条目在文件里已损坏，无法展开。');
        }

        const offCount = role.rows.filter((row) => row.disabled === true).length;
        const changedCount = role.rows.filter((row) => row.hasOverride === true).length;
      // 汇总覆盖整个能力列：下面的 MCP / 技能 / 插件 块也是开关。
      // 父层持有它们的条目，于是交回同一份 needle / onlyChanged 的计数。
        const extra =
          typeof extras === 'function'
            ? extras({ needle: query.trim().toLowerCase(), onlyChanged })
            : { total: 0, shown: 0, off: 0, changed: 0 };
        const summary = {
          total: role.rows.length + extra.total,
          shown: visible.length + extra.shown,
          off: offCount + extra.off,
          changed: changedCount + extra.changed,
        };
        const modeTitle = role.modeLabel || role.mode || 'standard';

        return h(
          'div',
          { style: styles.table },
      // 位置：能力行标题 → 还原默认 → 搜索框行 → MCP → 表头 → 各分组。
      // MCP 与「技能」这些分组是同一层，不缩进、不加左边线，标题与行都对齐。
      // 它作为 children 由调用方传入（GroupedTable 只负责位置）。
      // 说明文字与宿主 DEFAULT_NOTES.rows 逐字一致（多行，行首不留缩进）。
          section(
            '能力行',
            'rows',
            `这一列的行整体来自部署的 {mode} 模式模板（插件在构建时抽的快照，运行时只引用它）。
      每一行右边的勾选开关是「这个角色是否启用这一行」；改过的行左侧会有一条竖线。
      分组行（例如 persistent-shell）可以整组开关；组声明了 isolate 时那一行会标出来 —— 它只影响服务落在哪个 realm，不影响开关。
      平台门控已按 {platform} 解析。勾选框显示的是勾选即启用；左侧竖线表示该行被角色覆盖过。
      表里就是这个角色当前模式（见上面「模式」）的全部行；MCP 开关在角色详情里单独列出，因为四个模式里都没有这类行，它由连接器的连接生成。`,
            { mode: modeTitle },
          ),
          h(
            'div',
            { style: styles.row },
            h(
              'button',
              {
                style: styles.button,
                disabled: busy,
                title: describe(
                  'rowsReset',
                  '把所有行的开关与覆盖还原成 {mode} 模式模板的样子（MCP 开关与插件名单也一起清掉）',
                  { mode: modeTitle },
                ),
                onClick: () => onReset(),
              },
              '还原默认',
            ),
          ),
          h(
            'div',
            { style: styles.row },
            h('input', {
              style: styles.inputGrow,
              placeholder: '过滤：包名 / 行 id / 行名 / MCP server / 技能 / 插件',
              value: query,
              onChange: (event) => setQuery(event.target.value),
            }),
            h(
              'label',
              { style: { ...styles.hint, display: 'flex', gap: 6, alignItems: 'center' } },
              h('input', {
                type: 'checkbox',
                checked: onlyChanged,
                onChange: (event) => setOnlyChanged(event.target.checked),
              }),
              '只看被角色改过的行',
            ),
            h(
              'span',
              { style: styles.hint },
              `共 ${summary.total} 行 · 显示 ${summary.shown} · 已关 ${summary.off} · 被覆盖 ${summary.changed}`,
            ),
          ),
      // 渲染属性而不是固定数组：里面的 MCP / 技能 / 插件 块必须看到过滤框里的 needle，
      // 而只有这里持有它。（不能当函数 children 用 —— React 里函数 child 是非法的。）
          typeof panels === 'function'
            ? panels({ needle: query.trim().toLowerCase(), onlyChanged })
            : children,
          grouped.map(([category, rows]) =>
            h(
              'div',
              { key: category },
              h(
                'div',
                { style: styles.lineGroup },
                h(
                  'button',
                  {
                    style: styles.groupToggle,
                    onClick: () => fold(category),
                    title: expanded.has(category) ? '收起这一类' : '展开这一类',
                  },
                  expanded.has(category) ? '▾' : '▸',
                  ` ${CATEGORY_LABEL[category] || category}`,
                  h(
                    'span',
                    { style: styles.badge },
                    rows.length === totals.get(category)
                      ? `（${rows.length}）`
                      : `（显示 ${rows.length} / 共 ${totals.get(category) || 0}）`
                  ),
                ),
                h(
                  'span',
                  { style: { textAlign: 'center' } },
                  h('input', {
                    type: 'checkbox',
      // 这个复选框就是「全开 / 全关」（半选 = 一部分开着）：同一个动作只有一个入口。
                    title: '整类开关（全开 / 全关）',
      // 只有被点的这个复选框自己进入进行中（全局 busy 会把整张表 + 工具栏一起变灰）。
                    disabled: pending.has(`group:${category}`),
                    checked: rows.every((row) => effective(row)),
                    ref: (node) => {
                      if (node !== null) {
                        const on = rows.filter((row) => effective(row)).length;
                        node.indeterminate = on > 0 && on < rows.length;
                      }
                    },
                    onChange: (event) => onBulk(rows, event.target.checked, category),
                  }),
                ),
              ),
              expanded.has(category)
                ? rows.map((row) =>
                h(
                  React.Fragment,
                  { key: row.path },
                  h(
                  'div',
                  {
                    style: {
      // 二级行 = 范式里的 child（缩进一级），文字与上面分类标题起在同一条竖线上。
      // 这里不按 row.parent 再分层：那张表按 row.path 平铺、按类别分组，父亲行在「分组」那一类里
      // 看不见，缩进什么都说明不了；层级信息 row.path 本身已经写全了。
                      ...styles.child,
                      ...(row.hasOverride ? styles.lineOverride : null),
                    },
                  },
                  h(
                    'span',
                    {
                      style: styles.id,
      // 只显示行名。行的配置是插件作者的事，好奇的人看悬浮提示即可；
      // 这份列表只回答一个问题：这是哪个开关。
                      title: [
                        row.name || '',
                        row.path,
                        row.config === null || row.group ? '' : JSON.stringify(row.config),
                      ]
                        .filter((part) => part.length > 0)
                        .join(' — '),
                    },
                    row.path,
      // 分组可以声明 isolate：它的某些服务待在独立 realm 里，而不是与部署共享。
      // 它不影响行是否启用，所以画成标记而不是开关；但在这组里切行的人该知道这组装配方式不同。
                    row.isolate && typeof row.isolate === 'object' && Object.keys(row.isolate).length > 0
                      ? h(
                          'span',
                          {
                            style: styles.badge,
                            title:
                              `这个组声明的服务隔离：${Object.keys(row.isolate).join('、')}。` +
                              'true = 该实现在本组自己的 realm 里，具名值 = 按同名 label 共享的 realm；' +
                              '隔离不改变行是否启用，只决定服务实例被谁看见。',
                          },
                          `隔离 ${Object.keys(row.isolate).join('/')}`,
                        )
                      : null,
                  ),
                  h('span', { style: { textAlign: 'center' } }, h('input', {
                    type: 'checkbox',
      // 只有这一行自己的请求会让它变灰。
                    disabled: pending.has(`row:${row.id}`),
                    checked: effective(row),
                    title:
                      row.templateDisabled !== row.disabled
                        ? '已被角色覆盖'
                        : '跟随模板（当前平台）',
                    onChange: (event) => onToggle(row, event.target.checked),
                  })),
                  ),
                ),
              ) : null,
            ),
          ),
        );
      }

      // 一个角色正好一个目录，规则文件就是目录里的 AGENTS.md，宿主侧已经接好了，这里没什么可选。
      // 发现键仍可经 HTTP（agent-instructions 行的 set-override）手改，界面不再给第二处入口。

      exports.GroupedTable = GroupedTable;

    });

    __define("./panels/mcp.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // MCP 面板。

      const { filterEntries, mcpEntries } = __load('./entries.js');
      const { info, section } = __load('./notes.js');
      const { React, h } = __load('./react.js');
      const { styles } = __load('./styles.js');

      function McpPanel({ role, mcp, pending, onToggle, onBulk, needle = '', onlyChanged = false }) {
      // MCP 列表默认折叠，与技能那一块一致。
        const [open, setOpen] = React.useState(false);
        const capabilities = role.capabilities || {};
        const deny = new Set((capabilities.mcp || {}).deny || []);
        const services = (mcp && mcp.services) || [];
        const header = (text) =>
          h(
            'button',
      // 不叠加 styles.sectionTitle（13px/700）：MCP 这一行与分组行同级，字号字重保持一致（600，字号继承 13px）。
            { style: styles.groupToggle, onClick: () => setOpen(!open), title: open ? '收起' : '展开' },
            open ? '▾' : '▸',
            ` ${text}`,
          );

      // 旧版宿主根本不发 mcp：要明说，而不是渲染成「连接器没有连接」—— 那是假话。
        if (mcp === undefined) {
          return h(
            'div',
            { style: styles.field },
            section(
              'MCP 开关',
              'mcpNoState',
              '宿主侧还没重启，这次 /state 还没有 mcp 段——重启 dsh 后这里才会列出连接器里的 server。',
            ),
          )
        }

        if (mcp.error) {
          return h(
            'div',
            { style: styles.field },
            section('MCP 开关'),
            h('div', { style: styles.error }, `读不到连接器的存储文件：${mcp.error}`),
          );
        }

      // MCP 这一行也要有一个整行开关，和各分组标题行长得一样：它就是全开 / 全关（半选 = 只开了一部分）。
        const allow = services.filter((service) => !deny.has(service.serverName));
      // 与其它块同一条 needle / 只看改过的规则。
        const entries = filterEntries(mcpEntries(role, mcp), needle, onlyChanged);

        return h(
          'div',
          { style: styles.field },
          h(
            'div',
      // 和分组行用同一套 styles.panelHeader（灰底 + 两列网格），
      // 不是 styles.sectionHeader（只有下划线、没底色），这样灰底层级才和下面的分组行一致。
            { style: styles.panelHeader },
            h(
              'span',
              { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
              header(`MCP 开关（部署里有 ${services.length} 个 server）`),
              info(
                'mcpIntro',
                '取消勾选只是让这个角色看不见该 server 的工具（mcp__<名字>__*），连接器与其它角色都不受影响。',
              ),
            ),
            h(
              'span',
              { style: { textAlign: 'center' } },
              services.length === 0
                ? null
                : h('input', {
                    type: 'checkbox',
      // 和分组行同一个入口：复选框 = 全开 / 全关。
                    title: '全部 server 一起开 / 关（半选 = 只开了一部分）',
                    disabled: pending.has('mcp:*'),
                    checked: allow.length === services.length,
                    ref: (node) => {
                      if (node !== null) {
                        node.indeterminate = allow.length > 0 && allow.length < services.length;
                      }
                    },
                    onChange: (event) => onBulk(event.target.checked),
                  }),
            ),
          ),
          open === false
            ? null
            : h(
                'div',
                { style: styles.table },
                services.length === 0
                  ? h('div', { style: styles.hint }, '连接器里还没有任何 MCP 连接。')
                  : entries.length === 0
                    ? h(
                        'div',
                        { style: styles.hint },
                        '没有匹配的 server（清掉过滤框，或取消「只看被角色改过的行」）。',
                      )
                    : entries.map(({ item: service }) =>
                      h(
                        'div',
                        {
                          key: service.serverName,
                          style: styles.child,
                          title: [
                            service.serverName,
                            service.label || '',
                            `连接器：${service.enabled ? '已启用' : '已停用'}`,
                            service.target ? `目标：${service.target}` : '',
                          ]
                            .filter((part) => part.length > 0)
                            .join(' — '),
                        },
                        h(
                          'span',
                          { style: styles.id },
                          service.serverName,
                          service.enabled
                            ? null
                            : h('span', { style: styles.badge }, '连接器里已停用'),
                        ),
                        h('span', { style: { textAlign: 'center' } }, h('input', {
                          type: 'checkbox',
      // 逐 server 的 pending。
                          disabled: pending.has(`mcp:${service.serverName}`),
                          checked: !deny.has(service.serverName),
                          title: deny.has(service.serverName)
                            ? '这个角色看不见该 server 的工具'
                            : '跟随部署（该角色能看见该 server 的工具）',
                          onChange: (event) => onToggle(service.serverName, event.target.checked),
                        })),
                      ),
                    ),
              ),
        );
      }

      /** 部署全局注册的工具名单（ego_*、list_agents…），每个都是一个**按角色**的可见性开关。
       * 和上面「工具 (19)」那一组不是一回事：那是整个插件没挂载；
       * 这里插件照跑，只是对这个角色藏掉具体工具。 */

      exports.McpPanel = McpPanel;

    });

    __define("./panels/mode.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 模式面板。

      const { describe, note, section } = __load('./notes.js');
      const { h } = __load('./react.js');
      const { styles } = __load('./styles.js');

      function ModePanel({ role, modes, busy, onSet }) {
        const list = Array.isArray(modes) && modes.length > 0 ? modes : null;
      // 默认选中「这条角色实际挂的预设」（= 它自己那份复制品，/state 里叫 role.presetId），
      // 不是模板（role.mode）。只显示模板会让「看到 user、实际挂的是复制品」变成骗人的显示。
        const actual = typeof role.presetId === 'string' && role.presetId !== '' ? role.presetId : '';
        const listed = list !== null && actual !== '' && list.some((mode) => mode.id === actual);
        const current = listed ? actual : role.mode || 'standard';
        const known = list === null ? [] : list.map((mode) => mode.id);
      // 角色自己的模式永远是一个选项，哪怕 roster 已经不再提供它（预设被删）
      // 已存盘的角色必须还能读，也不能只是打开面板就把值悄悄跳到别的模式。
        const options =
          list === null || known.includes(current)
            ? list
            : [{ id: current, label: role.modeLabel || current, available: role.modeAvailable !== false }, ...list];
        const chosen = options === null ? null : options.find((mode) => mode.id === current);

        if (list === null) {
          return h(
            'div',
            { style: styles.field },
            section(
              '模式',
              'modeNoState',
              '宿主侧还没重启，这次 /state 里还没有 modes 段。',
            ),
          );
        }

        const describeMode = (mode) => {
          if (mode.source === 'role') return '这是这个角色自己注册的预设（从模板复制而来，改角色配置时重建）。';
          if (mode.available === false) return '这个模式现在组不出来：部署里没有它的预设声明。';
          return `直接读部署当前的预设声明${mode.rowCount === undefined ? '' : `（${mode.rowCount} 条顶层行）`}`;
        };
      // 当前模式从哪来：收进「模式」标题旁的 ⓘ 说明，行内不显示。
      // 没有快照文件了，每一份都是直接读部署当前的预设声明。
        const chosenSource = chosen === undefined ? '' : describeMode(chosen);
      // 选中的是自己那份时，把模板单独说清楚：改模板会重建这份预设，但名字 / 身份不变。
        const templateNote = listed ? `模板：${role.modeLabel || role.mode}` : '';

        return h(
          'div',
          { style: styles.field },
          section(
            '模式',
            'modeIntro',
            note(
              describe(
                'modeIntro',
                '这个角色的能力行整体来自所选的模式（dsh 自带的或你自己建的 preset，插件只是引用）。',
              ),
              describe(
                'modeKeepsOverrides',
                '切换模式不改你在这个角色上做过的任何开关：覆盖是按行 id 存的，新模式里有同 id 的行就继续生效。',
              ),
              role.modeAvailable === false
                ? describe('modeSnapshotMissing', '这个模式现在组不出来（部署里没有它的预设声明），暂时按标准模式组装。')
                : '',
              current === 'minimal'
                ? describe(
                    'modeMinimal',
                    '极简模式只有 persona 与一个终端组：没有 agent-instructions 行，所以这个角色自己的 AGENTS.md 不会被读取，也没有上下文继承那一行可切。',
                  )
                : '',
            ),
            undefined,
            note(chosenSource, templateNote),
          ),
      // 下拉框单独一行、撑满上限宽度。
          h(
            'select',
            {
              style: styles.select,
              value: current,
              disabled: busy,
              title: chosen === undefined ? undefined : describeMode(chosen),
              onChange: (event) => {
                const next = event.target.value;
                if (next !== current) onSet(next);
              },
            },
            options.map((mode) =>
              h(
                'option',
                {
                  key: mode.id,
                  value: mode.id,
      // 别的角色的自有预设列出来是为了「看得见全部预设」，但不能当模板。
                  disabled: mode.available === false || (mode.source === 'role' && mode.id !== actual),
                  title: describeMode(mode),
                },
                mode.available === false ? `${mode.label}（不可用）` : mode.label,
              ),
            ),
          ),
        );
      }

      /** 「再给一行设置 id」：角色 id 就是成员名带 team- 前缀，
       * 不显式给 id 时中文角色名会回落到码点哈希（team-rfozlm 这种没人记得的名字）。
       * 新建行直接收 id，这里把输入规范化，杂字符到不了宿主（宿主会拒）。 */

      exports.ModePanel = ModePanel;

    });

    __define("./panels/model.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 模型面板：这个角色跑在哪个 provider / 模型 / 推理强度上。

      const { describe, note, section } = __load('./notes.js');
      const { h } = __load('./react.js');
      const { styles } = __load('./styles.js');

      /** 三态：跟随模板（空）/ 指定。指定时写一行 agent-default-model。 */
      function ModelPanel({ role, catalog, busy, onSet }) {
        const model = role.model ?? { provider: '', model: '', reasoningEffort: '' };
        const specified = String(model.provider ?? '') !== '' && String(model.model ?? '') !== '';
        const providers = Array.isArray(catalog?.providers) ? catalog.providers : [];
        const current = providers.find((entry) => entry.id === model.provider);
        const models = current === undefined ? [] : current.models;
        const currentModel = models.find((entry) => entry.id === model.model);
        const efforts = currentModel === undefined ? [] : currentModel.efforts;
        const catalogError = typeof catalog?.error === 'string' ? catalog.error : '';

        return h(
          'div',
          { style: styles.field },
          section(
            '模型',
            specified ? 'modelOn' : 'modelOff',
            note(
              describe(
                'modelIntro',
                '不指定就跟模板走：这个角色用什么模型，取决于所选模式里部署配的默认模型。',
              ),
              describe(
                'modelRow',
                '指定时会在这个角色的预设里加一行 agent-default-model（provider / model / reasoningEffort），只作用于绑到这个角色的成员。',
              ),
              catalogError === '' ? '' : describe('modelCatalog', '读不到模型清单（{error}），可以手填。', { error: catalogError }),
            ),
          ),
          h(
            'div',
            { style: styles.row },
            h('input', {
              type: 'checkbox',
              disabled: busy,
              checked: specified,
              title: specified ? '这个角色用自己的模型' : '这个角色跟随模板的默认模型',
              onChange: (event) => {
                if (!event.target.checked) {
                  onSet({ provider: '', model: '', reasoningEffort: '' });
                  return;
                }
                // 勾上时三格还是空的，挑当前部署的第一个 provider 与它的第一个模型填进去，
                // 否则「指定」这个状态建不起来（空 provider + 空 model 会被宿主判为跟随模板）。
                const first = providers[0];
                if (first === undefined) return;
                const firstModel = Array.isArray(first.models) && first.models.length > 0 ? first.models[0].id : '';
                onSet({ provider: first.id, model: firstModel, reasoningEffort: '' });
              },
            }),
            h('span', null, '指定模型（不勾 = 跟随模板）'),
          ),
          specified
            ? h(
                'div',
                null,
                h(
                  'select',
                  {
                    style: styles.select,
                    value: model.provider,
                    disabled: busy,
                    title: 'provider',
                    onChange: (event) => {
                      const next = providers.find((entry) => entry.id === event.target.value);
                      const nextModel = next !== undefined && next.models.length > 0 ? next.models[0].id : '';
                      onSet({ provider: event.target.value, model: nextModel, reasoningEffort: '' });
                    },
                  },
                  providers.length === 0
                    ? h('option', { key: model.provider, value: model.provider }, model.provider)
                    : providers.map((entry) =>
                        h('option', { key: entry.id, value: entry.id }, `${entry.label}（${entry.id}）`),
                      ),
                ),
                h(
                  'select',
                  {
                    style: styles.select,
                    value: model.model,
                    disabled: busy,
                    title: 'model',
                    onChange: (event) => onSet({ ...model, model: event.target.value, reasoningEffort: '' }),
                  },
                  models.length === 0
                    ? h('option', { key: model.model, value: model.model }, model.model)
                    : models.map((entry) =>
                        h('option', { key: entry.id, value: entry.id }, entry.label ?? entry.id),
                      ),
                ),
                h(
                  'select',
                  {
                    style: styles.select,
                    value: model.reasoningEffort ?? '',
                    disabled: busy,
                    title: 'reasoning effort',
                    onChange: (event) => onSet({ ...model, reasoningEffort: event.target.value }),
                  },
                  h('option', { key: '', value: '' }, '推理强度：适配器默认'),
                  efforts.map((effort) => h('option', { key: effort.id, value: effort.id }, effort.name)),
                ),
              )
            : null,
        );
      }

      exports.ModelPanel = ModelPanel;

    });

    __define("./panels/plugins.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 插件 / 工具门面板。

      const { filterEntries, groupTools, toolEntries } = __load('./entries.js');
      const { describe, info, section } = __load('./notes.js');
      const { React, h } = __load('./react.js');
      const { styles } = __load('./styles.js');

      function PluginsPanel({
        role,
        toolGate,
        pending,
        onToggle,
        onBulk,
        onGroup,
        needle = '',
        onlyChanged = false,
      }) {
      // 默认折叠，和 MCP / 技能两块一样。
        const [open, setOpen] = React.useState(false);
      // 组也默认收起（67 个工具平铺出来就是这么来的），搜索时自动把匹配到的组摊开。
        const [unfolded, setUnfolded] = React.useState(() => new Set());
        const capabilities = role.capabilities || {};
        const deny = new Set(((capabilities.toolGate || {}).deny) || []);
        const tools = (toolGate && toolGate.tools) || [];
        const header = (text) =>
          h(
            'button',
            { style: styles.groupToggle, onClick: () => setOpen(!open), title: open ? '收起' : '展开' },
            open ? '▾' : '▸',
            ` ${text}`,
          );

        if (toolGate === undefined) {
          return h(
            'div',
            { style: styles.field },
            section(
              '插件',
              'toolGateNoState',
              '宿主侧还没重启，这次 /state 还没有 toolGate 段——重启 dsh 后这里才会列出部署全局注册的工具。',
            ),
          );
        }

      // 与其它块同一条过滤规则，条目来自同一份。
        const entries = filterEntries(toolEntries(role, toolGate), needle, onlyChanged);
        const keep = new Set(entries.map((entry) => entry.key));
        const layout = groupTools(toolEntries(role, toolGate));
        const groups = layout.groups
          .map((group) => ({
            key: group.key,
            members: group.members,
            shown: group.members.filter((entry) => keep.has(entry.key)),
          }))
          .filter((group) => group.shown.length > 0);
        const loose = layout.loose.filter((entry) => keep.has(entry.key));
        const allow = tools.filter((tool) => !deny.has(tool.name));

        const foldGroup = (key) => {
          setUnfolded((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
        };

        const toolRow = ({ item: tool }) =>
          h(
            'div',
            {
              key: `tool:${tool.name}`,
              style: styles.child,
              title: [tool.name, tool.description || '']
                .filter((part) => part.length > 0)
                .join(' — '),
            },
            h('span', { style: styles.id }, tool.name),
            h(
              'span',
              { style: { textAlign: 'center' } },
              h('input', {
                type: 'checkbox',
                disabled: pending.has(`tool:${tool.name}`),
                checked: !deny.has(tool.name),
                title: deny.has(tool.name)
                  ? '这个角色看不见这个工具'
                  : '跟随部署（该角色能看见这个工具）',
                onChange: (event) => onToggle(tool.name, event.target.checked),
              }),
            ),
          );

      // 组头一行：标题 + 一个「整组一起开 / 关」的勾选框（半选 = 组里只关了一部分）。
      // 点它写的还是逐个精确工具名，所以整组一次落盘、一次重建。
        const groupRow = (group) => {
          const total = group.members.length;
          const off = group.members.filter((entry) => entry.off).length;
          const expanded = needle.length > 0 || onlyChanged || unfolded.has(group.key);
          const key = `toolgroup:${group.key}`;
          return [
            h(
              'div',
              {
                key: `group:${group.key}`,
                style: styles.lineStrong,
                title: `按名字前缀分组：${group.key}_*（${total} 个）`,
              },
              h(
                'span',
                { style: styles.id },
                h(
                  'button',
                  {
                    style: styles.groupToggle,
                    onClick: () => foldGroup(group.key),
                    title: expanded ? '收起这一组' : '展开这一组',
                  },
                  expanded ? '▾' : '▸',
                  ` ${group.key}（${total} 个${off > 0 ? ` · 已关 ${off}` : ''}）`,
                ),
              ),
              h(
                'span',
                { style: { textAlign: 'center' } },
                h('input', {
                  type: 'checkbox',
                  disabled: pending.has(key),
                  checked: off === 0,
                  title: off === 0 ? '整组都关掉' : '整组都打开',
                  ref: (node) => {
                    if (node !== null) node.indeterminate = off > 0 && off < total;
                  },
                  onChange: (event) =>
                    onGroup(
                      group.key,
                      group.members.map((entry) => entry.item.name),
                      event.target.checked,
                    ),
                }),
              ),
            ),
            ...(expanded ? group.shown.map(toolRow) : []),
          ];
        };

        const body = [];
        for (const group of groups) body.push(...groupRow(group));
        for (const entry of loose) body.push(toolRow(entry));

        return h(
          'div',
          { style: styles.field },
          h(
            'div',
            { style: styles.panelHeader },
            h(
              'span',
              { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
              header(`插件（部署里有 ${tools.length} 个可禁用的工具）`),
              info(
                'toolGateIntro',
                '取消勾选 = 这个角色（以及它派生的成员）看不见这个工具：插件仍在运行，别的角色照旧。',
                describe(
                  'toolGateVsRows',
                  '和上面「工具」分组不是一回事：那一组是模式模板行，关掉等于**不挂载**整个插件；这里关掉的只是这个角色的可见性。',
                ),
                describe(
                  'toolGateGroups',
                  '名字前缀相同、且数量 ≥3 的自动归成一组（组头那个勾选框 = 整组一起开 / 关），其余平铺在外面。工具清单里没有「属于哪个插件」这个字段，所以只能按名字前缀分组。',
                ),
                describe(
                  'toolGateScope',
                  'MCP 的工具由上面的 MCP 开关按 server 整片管；run_code 注册表不允许遮蔽。这两类都不在下面这份名单里。',
                ),
              ),
            ),
            h(
              'span',
              { style: { textAlign: 'center' } },
              tools.length === 0
                ? null
                : h('input', {
                    type: 'checkbox',
                    title: '全部工具一起开 / 关（半选 = 只开了一部分）',
                    disabled: pending.has('tool:*'),
                    checked: allow.length === tools.length,
                    ref: (node) => {
                      if (node !== null) {
                        node.indeterminate = allow.length > 0 && allow.length < tools.length;
                      }
                    },
                    onChange: (event) => onBulk(event.target.checked),
                  }),
            ),
          ),
          toolGate.error
            ? h('div', { style: styles.error }, `读不到工具清单：${toolGate.error}`)
            : null,
          open === false
            ? null
            : h(
                'div',
                { style: styles.table },
                tools.length === 0
                  ? h('div', { style: styles.hint }, '这个部署的全局层没有可禁用的工具。')
                  : body.length === 0
                    ? h(
                        'div',
                        { style: styles.hint },
                        '没有匹配的工具（清掉过滤框，或取消「只看被角色改过的行」）。',
                      )
                    : body,
              ),
        );
      }

      /** 角色的工作目录：一个路径、一个还原键。
       * 没有 loop 路径选择器，也没有「复制标准模式」：agent-loop 根本住不进预设（它独占 agent-factory
       * 槽位，挂一个进去整份预设都失败），而且任务的工作目录在任务创建时就定了。 */

      exports.PluginsPanel = PluginsPanel;

    });

    __define("./panels/skills.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 技能列表面板。

      const { filterEntries, needleMatches, skillEntries } = __load('./entries.js');
      const { describe, info, note, section } = __load('./notes.js');
      const { React, h } = __load('./react.js');
      const { styles } = __load('./styles.js');

      function SkillsPanel({ role, skills, pending, onSet, needle = '', onlyChanged = false }) {
      // 默认折叠，跟 MCP 那一块一样。
        const [open, setOpen] = React.useState(false);
        const decision =
          role.skills || { mode: 'inherit', ids: [], dirs: [], missing: [], hasFilesystemRow: true, hasToolRow: true };
        const chosen = new Set(decision.ids || []);
        const pick = decision.mode === 'pick';
        const available = (skills && skills.available) || [];
        const missing = decision.missing || [];
      // 技能列表同样吃能力列的过滤框；missing 指向磁盘上故意不存在的东西，
      // 所以只响应 needle，不响应「只看改过的」。
        const availableShown = filterEntries(skillEntries(role, skills), needle, onlyChanged);
        const missingShown = missing.filter((name) => needleMatches(needle, name));
        const header = (text) =>
          h(
            'button',
            { style: styles.groupToggle, onClick: () => setOpen(!open), title: open ? '收起' : '展开' },
            open ? '▾' : '▸',
            ` ${text}`,
          );

        if (skills === undefined) {
          return h(
            'div',
            { style: styles.field },
            section(
              '技能',
              'skillsNoState',
              '宿主侧还没重启，这次 /state 还没有 skills 段——重启 dsh 后这里才会列出技能。',
            ),
          );
        }

        const counting = pick ? `只挂勾选的 ${chosen.size} 个` : '继承这个模式的默认技能';
        const allChosen = available.length > 0 && available.every((skill) => chosen.has(skill.name));
      // 这个技能自己的 round trip：点一个技能只灰它自己那一行，不会把 18 行 + 全选框一起变灰。
        const rowPending = (name) => pending !== undefined && pending.has(`skill:${name}`);
        const anyPending =
          pending !== undefined &&
          (pending.has('skill:mode') || available.some((skill) => pending.has(`skill:${skill.name}`)));
        const onFlip = (name, on) => {
          const next = new Set(chosen);
          if (on) next.add(name);
          else next.delete(name);
          onSet({ mode: 'pick', ids: [...next] }, [`skill:${name}`]);
        };
      // 这一格也是全选（半选 = 只勾了一部分）。勾上就是用、不勾就是不加载
      // 全部不勾 = 这个角色一个技能都不加载；要回到这个模式的默认技能，用下面的还原按钮（那是模式，不是名单）。
        const onBulk = (on) => {
          const keys = available.map((skill) => `skill:${skill.name}`);
          return on
            ? onSet({ mode: 'pick', ids: available.map((skill) => skill.name) }, keys)
            : onSet({ mode: 'pick', ids: [] }, keys);
        };

        return h(
          'div',
          { style: styles.field },
          h(
            'div',
            { style: styles.panelHeader },
            h(
              'span',
              { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
              header(`技能（${counting}）`),
              info(
                'skillsIntro',
                note(
                  '勾上就是选用、取消就是不加载：勾选会把模式里已有的 skill-filesystem 行指向这些技能目录，原技能目录与预设文件都不动。',
                  describe(
                    'skillsHow',
                    '继承（默认）= 跟以前一样，用这个模式自己的技能发现；只挂勾选的 = 用下面这份名单，没勾的不加载。',
                  ),
                  describe(
                    'skillsGlobal',
                    '全局层注册的技能（例如技能管理器自己提供的）对所有角色都可见，这一层筛不掉。',
                  ),
                ),
              ),
            ),
            h(
              'span',
              { style: { textAlign: 'center' } },
              available.length === 0
                ? null
                : h('input', {
                    type: 'checkbox',
                    title: pick
                      ? '全部勾上 / 全部不勾（不勾 = 一个技能都不加载；想回到「继承这个模式的默认技能」用下面那颗还原按钮）'
                      : '全部勾上 = 变成「只挂勾选的」并把下面列出的都勾上',
                    disabled: anyPending,
                    checked: pick && allChosen,
                    ref: (node) => {
                      if (node !== null) {
                        node.indeterminate = pick && chosen.size > 0 && !allChosen;
                      }
                    },
                    onChange: (event) => onBulk(event.target.checked),
                  }),
            ),
          ),
          open === false
            ? null
            : h(
                'div',
                { style: styles.table },
                pick
                  ? null
                  : h(
                      'div',
                      { style: styles.hint },
                      '这个角色跟随模式默认（不筛选）；在下面勾一个技能，它就会变成「只挂勾选的」。',
                    ),
                decision.hasFilesystemRow === false
                  ? h(
                      'div',
                      { style: styles.hint },
                      '这个模式没有技能行；勾选技能会按需给它补上 skill-filesystem 与 tool-skill 两行（成对，缺一不可）。',
                    )
                  : null,
                skills.error ? h('div', { style: styles.error }, `技能目录读不全：${skills.error}`) : null,
                available.length === 0
                  ? h('div', { style: styles.hint }, '这个部署的默认技能目录里没有技能（项目 .dsh/skills、~/.dsh/skills …）。')
                  : availableShown.length === 0
                    ? h(
                        'div',
                        { style: styles.hint },
                        '没有匹配的技能（清掉过滤框，或取消「只看被角色改过的行」）。',
                      )
                    : availableShown.map(({ item: skill }) =>
                      h(
                        'div',
                        {
                          key: skill.name,
                          style: styles.child,
                          title: [skill.name, skill.description || '', skill.dir].filter((part) => part.length > 0).join(' — '),
                        },
                        h(
                          'span',
                          { style: styles.id },
                          skill.name,
                          h('span', { style: { opacity: 0.6 } }, ` · ${skill.rootLabel}`),
                        ),
                        h(
                          'span',
                          { style: { textAlign: 'center' } },
                          h('input', {
                            type: 'checkbox',
                            disabled: rowPending(skill.name),
                            checked: chosen.has(skill.name),
                            title: skill.description || skill.name,
                            onChange: (event) => onFlip(skill.name, event.target.checked),
                          }),
                        ),
                      ),
                    ),
                missingShown.map((name) =>
                  h(
                    'div',
                    { key: `missing-${name}`, style: styles.child },
                    h('span', { style: styles.error }, `${name}（这个部署里已经没了，装回来才会挂载）`),
                    h(
                      'span',
                      { style: { textAlign: 'center' } },
                      h('input', {
                        type: 'checkbox',
                        disabled: rowPending(name),
                        checked: true,
                        title: '取消勾选 = 从名单里去掉',
                        onChange: () => onFlip(name, false),
                      }),
                    ),
                  ),
                ),
                h(
                  'div',
                  { style: styles.row },
                  h(
                    'button',
                    {
                      style: styles.button,
                      disabled: anyPending,
                      title: describe(
                        'skillsReset',
                        '把技能选择还原成「继承这个模式的默认技能」；已勾的名单会留着，方便再切回来。',
                      ),
                      onClick: () => onSet({ mode: 'inherit', ids: [...decision.ids] }, ['skill:mode']),
                    },
                    '还原技能选择',
                  ),
                ),
              ),
        );
      }

      /** 本部署的 MCP server 名单：宿主侧从连接器自己的存储里实时读出来。
       * 一行不是新建连接：取消勾选只是把 server 名记进角色的 mcp.deny，
       * 由承载这份名单的 gateway 行在角色内挂载，只对这个 agent 藏掉那些工具。 */

      exports.SkillsPanel = SkillsPanel;

    });

    __define("./panels/workdir.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 工作目录面板。

      const { describe, info, note, section } = __load('./notes.js');
      const { h } = __load('./react.js');
      const { styles } = __load('./styles.js');

      function WorkdirPanel({ role, workdir, busy, onReset }) {
        if (workdir === undefined) {
          return h(
            'div',
            { style: styles.field },
            section(
              '角色工作目录',
              'workdirNoState',
              '宿主侧还没重启，这次 /state 里还没有这一段。',
            ),
          );
        }

        const standard = workdir && workdir.standard;
        const parallel =
          standard && standard.config && standard.config.maxParallelToolCalls != null
            ? standard.config.maxParallelToolCalls
            : null;
      // 三处文案之一，三种状态都能在 notes.json 里改。
        const linkedKey =
          role.agentsMd && role.agentsMd.linked === true
            ? role.agentsMd.hasRow === false
              ? 'workdirNoRow'
              : 'workdirLinked'
            : 'workdirUnlinked';

        return h(
          'div',
          { style: styles.field },
          section(
            '角色工作目录',
            'workdirIntro',
            note(
              describe(
                'workdirIntro',
                '这个角色的规则文件就是这个目录里的 AGENTS.md，直接去改它就行：dsh 已经把这个文件接到该角色的 agent-instructions 行上，不管任务在哪个目录跑都会加载它。',
              ),
              role.agentsMd && role.agentsMd.source
                ? describe('workdirSource', '（新建时复制自 {source}）', { source: role.agentsMd.source })
                : describe('workdirNoSource', '（新建时没有可复制的来源，插件生成的空模板）'),
              standard
                ? describe(
                    'workdirWithLoop',
                    '任务在哪个目录跑由新建任务时选的目录决定，预设改不了它；部署的 agent-loop 也是全局的（maxParallelToolCalls={parallel}，角色不能各自覆盖）。',
                    { parallel: parallel == null ? '(默认)' : parallel },
                  )
                : describe(
                    'workdirWithoutLoop',
                    '任务在哪个目录跑由新建任务时选的目录决定，预设改不了它；本部署里没有 agent-loop 行。',
                  ),
            ),
          ),
          h('div', { style: styles.pre }, role.dir || '(未知)'),
          h(
            'div',
            { style: styles.row },
            h(
              'button',
              {
                style: styles.button,
                disabled: busy,
                title: describe(
                  'workdirReset',
                  '重新从主会话复制一份 AGENTS.md 覆盖这个角色目录里的文件，并清掉这个角色改过的 AGENTS.md 发现规则',
                ),
                onClick: onReset,
              },
              '还原默认',
            ),
            info(
              linkedKey,
              {
                workdirNoRow: '规则文件没接入：这个模式里没有 agent-instructions 行（见上面「模式」）',
                workdirLinked: '规则文件已接入这个角色',
                workdirUnlinked: '规则文件还没接入（角色条目异常）',
              }[linkedKey],
            ),
          ),
        );
      }

      /** 这个角色按哪个模式构建。
       * 集合是部署的事：名单来自 state.modes，宿主侧从 agentPresets.list() 填，
       * 用户新建或删除预设就换候选项，不用改插件；默认是标准模式。 */

      exports.WorkdirPanel = WorkdirPanel;

    });

    __define("./section/team-roles-columns.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 角色列表 + 详情列，JSX 整段保留。

      const { nakedMemberName } = __load('./constants.js');
      const { filterEntries, mcpEntries, skillEntries, toolEntries } = __load('./entries.js');
      const { describe, info } = __load('./notes.js');
      const { ContextPanel } = __load('./panels/context.js');
      const { GroupedTable } = __load('./panels/grouped-table.js');
      const { McpPanel } = __load('./panels/mcp.js');
      const { ModePanel } = __load('./panels/mode.js');
      const { ModelPanel } = __load('./panels/model.js');
      const { PluginsPanel } = __load('./panels/plugins.js');
      const { SkillsPanel } = __load('./panels/skills.js');
      const { WorkdirPanel } = __load('./panels/workdir.js');
      const { h } = __load('./react.js');
      const { styles } = __load('./styles.js');

      function TeamRolesColumns(vm) {
        const { brokenById, busy, clearDirty, commitSkills, deferredIds, description, displayRole, editDraft, idDraft, idDraftChanged, idDraftInvalid, idDraftTaken, name, onBulk, onContextToggle, onMcpBulk, onMcpToggle, onModelSet, onToggle, onToolBulk, onToolGroup, onToolToggle, order, pending, registeredIds, run, selectRole, selected, selectedId, selectedIdDraft, selectedMemberName, setDescription, setIdDraft, setName, setOrder, setSelectedId, newRoleIdPrefix, state } = vm;
          return h(
            'div',
            { style: styles.columns },
            h(
              'div',
              { style: styles.roles },
              h('div', { style: styles.label }, `角色（${state.roles.length}）`),
              state.roles.length === 0
                ? h('div', { style: styles.hint }, '还没有角色。')
                : state.roles.map((role) => {
      // 副标题只留「英文名(中文名)」：英文名 = 角色 id 去掉 team- 前缀（即成员名），
      // 中文名 = role.name；模式在下面单独配置，不再挤这一行。没中文名时不写空括号。
                    const memberName = nakedMemberName(role.id, newRoleIdPrefix);
                    const roleLabel =
                      typeof role.name === 'string' && role.name.length > 0 && role.name !== memberName
                        ? `${memberName}(${role.name})`
                        : memberName;
                    return h(
                      'button',
                      {
                        key: role.id,
                        style: { ...styles.roleItem, ...(role.id === selectedId ? styles.roleItemActive : null) },
                        onClick: () => {
      // 换角色：上一个角色的草稿作废（不保存），新角色按服务端值填充；
      // 必须一次提交做完（见 selectRole），否则会闪一帧红字把内容顶开。
                          selectRole(role.id);
                        },
                      },
                      roleLabel,
      // registered 含「已登记但还没挂载」的角色，不是错误
      // 改动已存进 JSON，等这个角色真被用到（创建成员或被选为会话预设）时才构建挂载。
                      deferredIds.includes(role.id)
                        ? h('div', { style: styles.hint }, '已存盘 · 下次用到该角色时生效')
                        : registeredIds === null
                          ? null
                          : registeredIds.includes(role.id)
                            ? null
                            : h('div', { style: styles.error }, '未注册'),
                      brokenById.has(role.id)
                        ? h(
                            'div',
                            { style: styles.error, title: brokenById.get(role.id) },
                            '挂载失败',
                          )
                        : null,
                    );
                  }),
            ),
            selected === null
              ? h('div', { style: { ...styles.detail, ...styles.hint } }, '上面先选一个角色。')
              : h(
                  'div',
                  { style: styles.detail },
                  brokenById.has(selected.id)
                    ? h(
                        'div',
                        { style: styles.error },
                        `这个角色的预设没能挂载，dsh 不会用上它：${brokenById.get(selected.id)}`,
                      )
                    : null,
                  h(
                    'div',
                    { style: styles.field },
                    h('span', { style: styles.label }, '名字'),
      // 走 editDraft：一改就记 dirty，之后任何 /state 回包都不覆盖这份草稿。
                    h('input', { style: styles.input, value: name, onChange: editDraft('name', setName) }),
                  ),
      // 角色 id 决定成员名（去掉 team- 前缀），改它等于把目录、role.json、
      // 已注册的 preset 一起换名；已建好的成员不会跟着改名。
                  h(
                    'div',
                    { style: styles.field },
                    h(
                      'span',
                      { style: { ...styles.label, ...styles.labelInline } },
                      '角色 ID（成员名）',
      // 常态说明收进标题旁的 ⓘ（文案键 roleMemberName，与宿主 DEFAULT_NOTES 逐字一致）。
                      info(
                        'roleMemberName',
                        '成员名：{member}（spawn_teammate 用这个名字）。角色 ID 决定成员名：改 ID 等于换成员名，已经建好的成员不会跟着改名。',
                        { member: selectedMemberName },
                      ),
                    ),
                    h('input', {
                      style: styles.input,
                      placeholder: '英文，例如 devtest',
                      value: idDraft,
                      onChange: (event) => setIdDraft(event.target.value),
                    }),
      // 只有「非法 / 被占用 / 改了还没保存」这三种要当场看见的状态才留在框下面。
                    idDraftInvalid || idDraftTaken || idDraftChanged
                      ? h(
                          'div',
                          { style: idDraftInvalid || idDraftTaken ? styles.error : styles.hint },
                          idDraftInvalid
                            ? '角色 ID 只能用英文小写字母、数字和短横线（例如 devtest、qa-1）。'
                            : idDraftTaken
                              ? `已经有角色在用这个 ID：${selectedIdDraft}`
                              : `保存后：角色 ID ${selectedIdDraft} · 成员名 ${selectedMemberName}（spawn_teammate 用这个名字；已经建好的成员不会跟着改名）`,
                        )
                      : null,
                  ),
                  h(
                    'div',
                    { style: styles.field },
                    h('span', { style: styles.label }, '描述'),
                    h('input', { style: styles.input, value: description, onChange: editDraft('description', setDescription) }),
                  ),
                  h(
                    'div',
                    { style: styles.field },
                    h('span', { style: styles.label }, '排序（越小越靠前）'),
                    h('input', {
                      style: styles.input,
                      value: order,
                      onChange: editDraft('order', setOrder),
                    }),
                  ),
                  h(
                    'div',
                    { style: styles.row },
                    h(
                      'button',
                      {
                        style: styles.button,
                        disabled: busy || idDraftInvalid || idDraftTaken,
                        onClick: async () => {
      // id 变了就一起换（宿主侧：目录 + role.json + preset 注册名同步改），
      // 回包带新 id，这里跟着重新选中。
                          const payload = await run({
                            action: 'update-role',
                            id: selected.id,
                            name,
                            description,
                            order: Number(order) || 0,
                            ...(idDraftChanged ? { newId: selectedIdDraft } : null),
                          });
      // 保存成功 = 草稿已落到服务端；解除 dirty 之后 /state 回包才允许重新填表单。
                          if (payload) clearDirty();
                          if (payload && payload.id) setSelectedId(payload.id);
                        },
                      },
                      '保存角色信息',
                    ),
                    h(
                      'button',
                      {
                        style: styles.button,
                        disabled: busy,
                        title: describe(
                          'resetRole',
                          '把模式、能力行、MCP 开关都还原成刚建好这个角色时的样子（模式回到标准模式）；保留名字 / 描述 / 这个角色自己的 AGENTS.md',
                        ),
                        onClick: () => {
      // 还原会把服务端值重写一遍，草稿作废。
                          clearDirty();
                          return run({ action: 'reset-role', id: selected.id });
                        },
                      },
                      '全部还原（保留名字与 AGENTS.md）',
                    ),
                    h(
                      'button',
                      {
                        style: { ...styles.button, ...styles.danger },
                        disabled: busy,
                        title: describe('deleteRole', '连这个角色的目录一起删（role.json 与 AGENTS.md 都会没）'),
                        onClick: () => {
      // 角色都没了，草稿当然也作废。
                          clearDirty();
                          return run({ action: 'delete-role', id: selected.id });
                        },
                      },
                      '删除角色',
                    ),
                  ),
      // 基础构成排在最前：下面每个面板都在四种模式之一上描述这个角色。
                  h(ModePanel, {
                    role: selected,
                    modes: state.modes,
                    busy,
                    onSet: (mode) => run({ action: 'set-mode', id: selected.id, mode }),
                  }),
      // 角色就是一个目录，一个路径说明一切：配置与规则文件都在里面（AGENTS.md 直接去路径下改）。
      // 这里只显示这一个路径，还原键也在这块。
                  h(WorkdirPanel, {
                    role: selected,
                    workdir: state.workdir,
                    busy,
                    onReset: () => run({ action: 'reset-item', id: selected.id, item: 'agents-md' }),
                  }),
      // 是否继承主会话上下文：覆盖模板自带的那一行（delegation/tool-subagent，provider 在 spawn↔fork）。
                  h(ContextPanel, {
                    role: displayRole,
                    busy: pending.has('context:tool-subagent'),
                    onSet: onContextToggle,
                  }),
      // 这个角色跑在哪个模型上：勾上才在预设里加 agent-default-model 行，不勾跟随模板。
                  h(ModelPanel, {
                    role: displayRole,
                    catalog: state.models,
                    busy: pending.has('model'),
                    onSet: onModelSet,
                  }),
      // 技能跟在 MCP 后面，同属能力行的子块（两者同一层，不缩进）。
      // MCP 列表作为 children 传进表格，渲染在能力行里、过滤行下面。
                  h(GroupedTable, {
                    role: displayRole,
                    platform: state.platform,
                    busy,
                    pending,
                    onToggle,
                    onBulk,
                    onReset: () => run({ action: 'reset-item', id: selected.id, item: 'rows' }),
      // 汇总行也统计下面三块：父组件持有 state.mcp / skills / toolGate，
      // 于是按与子块相同的条目和过滤规则在这里数，数字不会漂。
                    extras: ({ needle, onlyChanged }) => {
                      const entries = [
                        ...mcpEntries(displayRole, state.mcp),
                        ...skillEntries(displayRole, state.skills),
                        ...toolEntries(displayRole, state.toolGate),
                      ];
                      return {
                        total: entries.length,
                        shown: filterEntries(entries, needle, onlyChanged).length,
                        off: entries.filter((entry) => entry.off === true).length,
                        changed: entries.filter((entry) => entry.changed === true).length,
                      };
                    },
                    panels: ({ needle, onlyChanged }) => [
                      h(McpPanel, {
                        role: displayRole,
                        mcp: state.mcp,
                        pending,
                        onToggle: onMcpToggle,
                        onBulk: onMcpBulk,
                        needle,
                        onlyChanged,
                      }),
      // 位置在 MCP 与技能之间，名字叫「插件」。
                      h(PluginsPanel, {
                        role: displayRole,
                        toolGate: state.toolGate,
                        pending,
                        onToggle: onToolToggle,
                        onBulk: onToolBulk,
                        onGroup: onToolGroup,
                        needle,
                        onlyChanged,
                      }),
                      h(SkillsPanel, {
                        role: displayRole,
                        skills: state.skills,
      // 逐行的「进行中」集合：勾一个技能只灰它自己（MCP 那一套用同一个 pending）。
                        pending,
                        onSet: commitSkills,
                        needle,
                        onlyChanged,
                      }),
                    ],
                  }),
                ),
          );
      }

      exports.TeamRolesColumns = TeamRolesColumns;

    });

    __define("./section/team-roles-view.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 容器视图：工具条 / 开关 / 新建行；列区交给 columns。

      const { TeamRolesColumns } = __load('./section/team-roles-columns.js');
      const { describe, info, note } = __load('./notes.js');
      const { h } = __load('./react.js');
      const { styles } = __load('./styles.js');

      function TeamRolesView(vm) {
        const { busy, draftMemberName, draftRoleId, error, newId, newName, run, setNewId, setNewName, setSelectedId, setTeamResult, state, teamResult } = vm;
        return h(
          'div',
      // 页签页的宽度与居中在这里收口（设置面板当年给的宽度已经没了，见 styles.js 的 page）。
          { style: styles.page },
          h(
            'div',
            { style: styles.row },
      // 「刷新」就是重新从磁盘读角色文件（reload），顺带重同步预设。
            h(
              'button',
              {
                style: styles.button,
                disabled: busy,
                title: describe(
                  'refresh',
                  '重新读磁盘上的角色文件（roles.json 与各角色的 role.json / AGENTS.md），再同步一次预设。说明文字来自 notes.json，缺失的键用插件内置的那份。',
                ),
                onClick: () => run({ action: 'reload' }),
              },
              '刷新',
            ),
      // 说明表是数据，得有一条路把每个键写成文件给人看：一键写出，自己再改。
            h(
              'button',
              {
                style: styles.button,
                disabled: busy,
                title: describe(
                  'exportNotes',
                  '把当前用的说明文字整个写到 {file}（已经在那份文件里的键不会被覆盖），之后改那一份 json 就能集中改这些说明。',
                  { file: state.notesFile || 'notes.json' },
                ),
                onClick: () => run({ action: 'export-notes' }),
              },
              '导出说明文件',
            ),
          ),
          state.notes && state.notes.error
            ? h('div', { style: styles.error }, `说明文件（notes.json）读不了：${state.notes.error}`)
            : null,
          state.error ? h('div', { style: styles.error }, `角色文件无法解析：${state.error}`) : null,
          state.registryError
            ? h(
                'div',
                { style: styles.hint },
                `读预设清单失败：${state.registryError} —— 角色是否真的挂载成功，这次无法确认。`,
              )
            : null,
          error ? h('div', { style: styles.error }, error) : null,
          h(
            'label',
            { style: styles.row },
            h('input', {
              type: 'checkbox',
              checked: state.team !== undefined && state.team.enabled === true,
      // 三种「不能点」要分开：正忙、宿主侧没重启（字段还不存在）、这个部署没有可问的人
      // （没有 pluginManager）。把最后一种画成普通的「关」会让人以为点一下就能开。
              disabled: busy || state.team === undefined || state.team.available !== true,
              onChange: async (event) => {
                const payload = await run({ action: 'set-team', enabled: event.target.checked });
                setTeamResult(payload && payload.result ? payload.result : null);
              },
            }),
            '启用智能体团队',
            info(
              state.team === undefined ? 'hostStale' : state.team.available !== true ? 'teamUnavailable' : state.team.enabled === true ? 'teamOn' : 'teamOff',
              note(
                state.team === undefined
                  ? '宿主侧还没重启，重启 dsh 后这个开关才可用。'
                  : state.team.available !== true
                    ? state.team.reason
                    : state.team.enabled === true
                      ? `团队运行时已开${state.team.version ? `，组合包 ${state.team.version}` : ''}；委派的成员按名字认领同名角色。`
                      : '默认关。打开后 dsh 会把这个组合包选进 profile 的组合，团队协作工具随之出现。',
                state.bindMembersSource === 'config'
                  ? '插件配置里的 bindMembers 已强制打开成员绑定，这个开关关掉它也不受影响。'
                  : '',
              ),
              {
      // {version} 是 DEFAULT_NOTES 里的占位，带上这一句才不会留下字面量。
                version: state.team !== undefined && state.team.version ? `，组合包 ${state.team.version}` : '',
                reason: state.team === undefined ? '' : state.team.reason || '',
              },
            ),
          ),
          teamResult === null
            ? null
            : h(
                'div',
                { style: teamResult.error ? styles.error : styles.hint },
                `团队组合包：${teamResult.applicationLabel || teamResult.application || '已保存'}${
                  teamResult.error ? ` —— ${teamResult.error}` : ''
                }${teamResult.warnings && teamResult.warnings.length > 0 ? `（${teamResult.warnings.join('；')}）` : ''}`,
              ),
      // 新建区三行：两个输入框各占一整行，按钮单独一行（按钮不拉满，与「保存 / 全部还原 / 删除角色」那行一致）。
          h(
            'div',
            { style: styles.field },
            h('input', {
              style: styles.input,
              placeholder: '中文名，如：架构师',
              value: newName,
              onChange: (event) => setNewName(event.target.value),
            }),
          ),
      // 成员名 = 角色 id 去掉 team- 前缀；留空才回落到按名字自动生成（中文名会变成 team-rfozlm 这种哈希）。
          h(
            'div',
            { style: styles.field },
            h('input', {
              style: styles.input,
              placeholder: '英文名，如：dev',
              value: newId,
              onChange: (event) => setNewId(event.target.value),
            }),
          ),
          h(
            'div',
            { style: styles.row },
            h(
              'button',
              {
                style: styles.button,
                disabled: busy || newName.trim().length === 0 || (newId.trim().length > 0 && draftRoleId === ''),
      // 每个角色有自己的目录，这句说明收进按钮的悬浮提示里。
                title: describe(
                  'createRole',
                  '新建一个角色 = 建一个属于它的目录：role.json（这个角色的全部开关）+ AGENTS.md（从主会话复制一份，之后只用这份）。新角色的模式默认是标准模式。角色 ID 同时决定成员名（去掉 team- 前缀），留空则按名字自动生成。',
                ),
                onClick: async () => {
                  const payload = await run({
                    action: 'create-role',
                    name: newName.trim(),
                    ...(draftRoleId === '' ? null : { id: draftRoleId }),
                  });
                  if (payload && payload.id) setSelectedId(payload.id);
                  setNewName('');
                  setNewId('');
                },
              },
              '新建角色',
            ),
          ),
          newId.trim().length === 0
            ? null
            : h(
                'div',
                { style: draftRoleId === '' ? styles.error : styles.hint },
                draftRoleId === ''
                  ? '角色 ID 只能用英文小写字母、数字和短横线（例如 devtest、qa-1）。'
                  : `角色 ID：${draftRoleId} · 成员名：${draftMemberName}（spawn_teammate 用这个名字）`,
              ),
          h(TeamRolesColumns, vm),

        );
      }

      exports.TeamRolesView = TeamRolesView;

    });

    __define("./section/team-roles.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 容器组件：按原顺序串 3 个 hook + 视图（hook 顺序不能变）。

      const { h } = __load('./react.js');
      const { styles } = __load('./styles.js');
      const { useTeamRolesCore } = __load('./section/team-roles-core.js');
      const { useTeamRolesDrafts } = __load('./section/team-roles-drafts.js');
      const { useTeamRolesSwitches } = __load('./section/team-roles-switches.js');
      const { buildTeamRolesVm } = __load('./section/team-roles-vm.js');
      const { TeamRolesView } = __load('./section/team-roles-view.js');

      function TeamRolesSection() {
        const core = useTeamRolesCore();
        const drafts = useTeamRolesDrafts(core);
        const switches = useTeamRolesSwitches(core, drafts);
      // 提前返回：state 还没到之前不能建 vm（buildTeamRolesVm 会读 state.presetPrefix），只画「正在读取角色…」。
      // 必须落在调用 vm 之前，否则这段兜底形同虚设。
        if (core.state === null) {
          return h(
            'div',
            { style: styles.page },
            h('div', { style: styles.hint }, core.error || '正在读取角色…'),
          );
        }
        return h(TeamRolesView, buildTeamRolesVm(core, drafts, switches));
      }

      exports.TeamRolesSection = TeamRolesSection;

    });

    __define("./entry.js", (exports, __load) => {
      // 客户端真正源码（lib/client.js 是 node tools/build-client.mjs 的产物，勿手改）。
      // 插件入口：apply 与 name/inject。

      const { foldTeamEvents } = __load('./team-events.js');
      const { command } = __load('./net.js');
      const { TeamRolesSection } = __load('./section/team-roles.js');

      const name = 'dsh-agent-team-roles';
      const inject = ['slots', 'sessions'];

      function apply(ctx) {
      // 角色配置页放在会话页签栏（conversation.view 插槽）。
        ctx.effect(
          () =>
            ctx.slots.inject('conversation.view', () =>
              ctx.slots.register(
                { name: 'conversation.view', id: 'team-roles', order: 30, label: () => '角色' },
                TeamRolesSection,
              ),
            ),
          'dsh-agent-team-roles: roles tab',
        );

      // R5：「@成员 正文」直接发给成员，不进 Lead 的会话。
      // 本版对 @ 没有 Enter 裁决，所以用空格认领：成员名后的空格把这一行交给我们，随后的 Enter
      // 用正文作为参数提交，草稿因此永远不会到模型那里。
        ctx.inject(['inputTriggers'], (scoped) => {
          const inputTriggers = scoped.inputTriggers;
          if (
            inputTriggers === undefined ||
            inputTriggers === null ||
            typeof inputTriggers.registerSource !== 'function'
          ) {
            return;
          }

      /** 草稿所在的会话 → 它的 Lead。 */
          const leadIdOf = (sessionId) => {
            try {
              const snapshot = ctx.sessions.binding(sessionId)?.session?.getSnapshot?.();
              const parent = snapshot?.subagent?.address?.parentSessionId;
              return typeof parent === 'string' && parent.length > 0 ? parent : sessionId;
            } catch {
              return sessionId;
            }
          };

      /** 名册：先用共享投影，事件窗口兜底。 */
          const rosterOf = (leadId) => {
            try {
              const values = ctx.sessions.list.getSnapshot().projectionsBySession[leadId]?.values;
              if (values !== undefined && values !== null && Array.isArray(values.agentTeam?.members)) {
                return values.agentTeam.members;
              }
            } catch {
      // 回落到事件窗口
            }
            try {
              const window = ctx.sessions.binding(leadId)?.session?.eventSource?.getSnapshot?.();
              return window === undefined || window === null ? [] : foldTeamEvents(window).members;
            } catch {
              return [];
            }
          };

          const teammatesOf = (leadId) =>
            rosterOf(leadId).filter(
              (member) =>
                member !== null &&
                typeof member === 'object' &&
                typeof member.name === 'string' &&
                member.name.length > 0 &&
                member.role !== 'lead' &&
                member.phase !== 'failed',
            );

          const teammateNamed = (leadId, name) =>
            teammatesOf(leadId).find((member) => member.name === name);

      /** 把这一行认领为自己的命令：token 保留尾随空格（这才是进入认领态的原因），
       * 所以后面的文字作为 args 到来，草稿永远不会到模型。
       * @param {object} draft @returns {object | null} */
          const claimFor = (leadId, name, shown) => ({
            name: '@team-member',
            token: `${shown} `,
            hint: `直接发给 ${name}`,
            submit: async (args) => {
              const text = String(args ?? '').trim();
              if (text === '') return { kind: 'error', text: '正文是空的，没有发送。' };
              try {
                await command({ action: 'team-send', sessionId: leadId, target: name, body: text });
                return { kind: 'success' };
              } catch (error) {
                return { kind: 'error', text: String((error && error.message) || error) };
              }
            },
          });

          const source = {
            trigger: '@',
            name: 'agent-team-member',
            order: -10,
            showGroupTitle: false,
            async candidates(session, request) {
              const query = String(request?.query ?? '')
                .replace(/^@/u, '')
                .trim()
                .toLowerCase();
              return teammatesOf(leadIdOf(session.sessionId))
                .filter((member) => query === '' || member.name.toLowerCase().startsWith(query))
                .map((member) => ({ name: member.name, label: member.name, hint: '直接发送' }));
            },
            matchSpace(session, token) {
              const name = String(token ?? '').replace(/^@/u, '');
              if (name === '') return undefined;
              const leadId = leadIdOf(session.sessionId);
      // 不是成员 → 把 token 交回默认 sink，文件和会话引用照旧工作。
              if (teammateNamed(leadId, name) === undefined) return undefined;
              return { claim: claimFor(leadId, name, `@${name}`) };
            },
            onPick({ candidate, session, action }) {
              if (action !== 'pick') return undefined;
              const name = String(candidate?.name ?? '');
              if (name === '') return undefined;
              const leadId = leadIdOf(session.sessionId);
              if (teammateNamed(leadId, name) === undefined) return undefined;
              return { claim: claimFor(leadId, name, `@${name}`) };
            },
          };

          scoped.effect(() => inputTriggers.registerSource(source), 'agent-team-roles: @ member source');
        });
      }

      exports.apply = apply;
      exports.name = name;
      exports.inject = inject;

    });

    return __load("./entry.js");
  },
});
