/**
 * `dsh-agent-team-roles` — 浏览器半边（构建产物，请勿手工修改）。
 *
 * 源码在 `src/client/**`，由 `node tools/build-client.mjs` 生成这个文件。
 * 改代码请改源码，然后跑 `npm run build:client`；`npm test` 里带 `--check` 守着它不漂。
 *
 * 模块清单（依赖顺序）：
 *   ./chat/fold.js
 *   ./react.js
 *   ./tokens.js
 *   ./styles.js
 *   ./constants.js
 *   ./chat/colors.js
 *   ./chat/hooks.js
 *   ./chat/order.js
 *   ./chat/markdown-style.js
 *   ./chat/empty-view.js
 *   ./chat/stats-row.js
 *   ./chat/graph-view.js
 *   ./markdown.js
 *   ./chat/message-list.js
 *   ./chat/view.js
 *   ./entries.js
 *   ./net.js
 *   ./notes.js
 *   ./section/team-roles-core.js
 *   ./section/team-roles-drafts.js
 *   ./section/team-roles-switches.js
 *   ./section/role-id.js
 *   ./section/team-roles-vm.js
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

    __define("./chat/fold.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 群聊 tab：事件折叠（时钟 / 正文 / 去重合并）。

      //#region 群聊 tab（R7.5 / R7.7 / R7.8）
      /**
       * The shipped Agent Teams UI states its own limitation in its README
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

      exports.formatClock = formatClock;
      exports.blockText = blockText;
      exports.foldTeamEvents = foldTeamEvents;
      exports.mergeTeamLog = mergeTeamLog;

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
      // 角色色板（chat.palette）也收在这里：它是数据，但同样属于「颜色只在一个文件里定义」。
      // 分两层：T = 官方设计令牌 --dsw-*（宿主 theme 注入）；chat = 群聊页既有冻结值。

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

      /** 自绘下拉框的箭头（内嵌 svg）：appearance:none 之后原生箭头会消失，靠这张图补回来。
       * 设置区与群聊共用同一个资产。 */
      const caretImage =
        "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M1.5 3.75L5 7.25l3.5-3.5' fill='none' stroke='%23808080' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";

      // 颜色与调色板的权威在宿主侧（lib/roleColor.js），随 /state 与角色一起下来。
      // 下面这份只是回包前的兜底，以及角色表里没有的成员（手工起的名字）用的散列调色板，顺序与宿主侧一致。
      const PALETTE = [
        '#1D4ED8',
        '#0F766E',
        '#B91C1C',
        '#C2410C',
        '#A21CAF',
        '#4338CA',
        '#15803D',
        '#0369A1',
        '#9D174D',
        '#4D7C0F',
      ];

      /** 把 #rrggbb 按比例调淡（消息卡边框平时只到发送者色的 40%，悬停才转实色）。
       * 颜色字符串拼接也关在这一层，源文件里只调用；不是 #rrggbb 就原样返回。 */
      function withAlpha(color, alpha) {
        const hex = /^#([0-9a-fA-F]{6})$/.exec(String(color));
        if (hex === null) return color;
        const n = Number.parseInt(hex[1], 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
      }

      /** 群聊页既定值 —— UI 冻结：这些值一个字都不改，只搬个家。
       * 连 currentColor 这种跟着主题文字色走的写法也收在这里，源文件里不许再写。 */
      const chat = {
        hairline: 'rgba(128,128,128,0.28)', // 统计项 / 下拉框的亮灰细边
        hairlineBorder: '1px solid rgba(128,128,128,0.28)',
        inheritBorder: '1px solid currentColor', // 排序按钮等跟着文字色走的那档
        separator: 'rgba(128,128,128,0.35)', // 时间线左侧竖线
        separatorLine: '2px solid rgba(128,128,128,0.35)',
        dashed: 'rgba(128,128,128,0.4)',
        dashedBorder: '1px dashed rgba(128,128,128,0.4)', // 空态虚线框
        hoverFill: 'rgba(128,128,128,0.25)', // 排序按钮选中底
        focusRing: 'rgba(128,128,128,0.6)', // 下拉框聚焦边
        caretImage,
        chipText: '#ffffff',
        purple: '#6B21A8', // 主题紫 = Lead 色
        palette: PALETTE,
        timePurple: '#c4b5fd',
        ok: '#4a9d6a',
        pending: '#e8a33d',
        failed: '#e05252',
      };

      exports.T = T;
      exports.chat = chat;
      exports.caretImage = caretImage;
      exports.withAlpha = withAlpha;

    });

    __define("./styles.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 设置区样式 + 群聊 tab 样式（chatStyles）。
      // 颜色 / 圆角 / 字体不写字面量：全部来自 tokens.js（官方 --dsw-* 令牌或群聊冻结值），由测试钉住。

      const { T, chat, caretImage } = __load('./tokens.js');

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

      const chatStyles = {
      // 间距只用三档：8（组内）/ 12（块内）/ 20（块间），圆角统一 8（胶囊除外）；线只用于分隔性质不同的东西。
        root: { display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 14px', fontSize: F.md, minHeight: 0, flex: 1 },
      // 顶部统计行：行本身没有框，每个统计项各自一个小框，字号全程不动。
        header: {
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'baseline',
          color: 'inherit',
        },
      // 单个统计项的小框：亮灰细边 + 8px 圆角，数字 15px/600、标签 11px。
        stat: {
          display: 'flex',
          alignItems: 'baseline',
          gap: 5,
          border: chat.hairlineBorder,
          borderRadius: 8,
          padding: '2px 8px',
        },
        statValue: { fontSize: F.lg, fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' },
        statLabel: { fontSize: F.xs, opacity: 0.6 },
      // 零散小注解（「历史未载完」「整份日志」）：最轻的一级，不抢眼。
        note: { fontSize: F.xs, opacity: 0.55 },
        roster: { display: 'flex', gap: 6, flexWrap: 'wrap' },
      // 成员名单：每个成员用自己的角色色 + 白字，形状复用 nameChip（见 chat/view.js 的 rosterChipStyle）。
        list: { display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', minHeight: 0 },
      // 消息卡片的整圈边框 = 发送者自己的角色色；只染边框，卡片底色与文字保持原样。
      // 颜色不写在这里：它在角色的 role.json 里，由 chat/colors.js 从 /state 取、渲染时 inline 上色；
      // 样式表只留形状。
        message: { border: '1px solid transparent', borderRadius: 8, padding: '8px 12px', transition: 'border-color 0.12s ease' },
      // 「谁 → 谁」这一行：发送者与收件人共用同一种实底白字 chip，只用颜色区分角色、不分主次，
      // 时间与状态靠右。
        meta: {
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          fontSize: F.xs,
          opacity: 1,
          marginBottom: 4,
          flexWrap: 'wrap',
        },
        nameChip: {
          fontWeight: 700,
          fontSize: F.sm,
          letterSpacing: '0.02em',
          color: chat.chipText,
          background: chat.purple,
          borderRadius: 6,
          padding: '1px 7px',
        },
        metaRight: { marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' },
      // 时间固定淡紫、不跟状态变色；送达状态保持自己的绿 / 橙 / 红（ok / pending / failed）。
        time: { color: chat.timePurple, fontVariantNumeric: 'tabular-nums' },
        body: { margin: 0, fontFamily: 'inherit', fontSize: F.sm, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
        ok: { color: chat.ok },
      // 每一条的发送结果保持独立的绿 / 红，不受发送者颜色影响。
        pending: { color: chat.pending },
        failed: { color: chat.failed, fontWeight: 600 },
      // 分区标题（「角色依赖图」/「消息流」）保留标题色（主题紫 = Lead 色），
      // 但去掉了通栏下划线：分段靠 20px 组间距 + 8px 标题下间距。
        sectionTitle: { fontSize: F.sm, fontWeight: 600, letterSpacing: '0.04em', color: chat.purple },
      // 标题行：标题在左，右侧放该区的控件（消息流的排序）。不画分隔线。
        sectionBar: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 20,
          paddingBottom: 8,
        },
        orderGroup: { display: 'flex', gap: 4, marginLeft: 'auto' },
        orderBtn: {
          padding: '1px 8px',
          borderRadius: 6,
          border: chat.inheritBorder,
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          fontSize: F.xs,
          opacity: 0.6,
        },
        // 当前生效的那一侧（默认倒序）实心高亮，一眼看出现在按哪种顺序读。
        orderOn: { opacity: 1, fontWeight: 700, background: chat.hoverFill },
        // 用户 2026-10-13：「@统计周期 去掉 @，把整行搞好看一点、大一点点」——整行当一条工具条
        // 13px、控件加高加圆角；后来（同日）「去掉灰底，加个亮灰色框框」——填充改成描边。
        controls: {
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
          fontSize: F.md,
          fontWeight: 400,
          color: 'inherit',
          // 用户 2026-10-13：「第二行我框起来的去掉灰底，加个亮灰色框框」→ 再去掉外框，
          // 现在这一条只剩白底与两个下拉框，灰色全部下放到控件自身。
          background: 'transparent',
          border: 'none',
          borderRadius: 8,
          padding: '6px 0',
        },
        // 短横线分隔符（<起始> - <结束>），用最轻的一级灰。
        controlLabel: { fontSize: F.sm, opacity: 0.6 },
        select: {
          font: 'inherit',
          fontSize: F.md,
          // 用户 2026-10-13：「点击再取消后框框不见了」→ 跟着宿主的做法走：关掉原生外观
          // （`appearance:none`）自己画箭头，边框永远由我们控制，浏览器那圈焦点外观不再插手。
          appearance: 'none',
          WebkitAppearance: 'none',
          outline: 'none',
          padding: '3px 22px 3px 8px',
          borderRadius: 6,
      // 白底 + 亮灰细边。长写三件套（不是 border 简写）：聚焦态只覆盖 borderColor，
      // 若这里是简写，失焦那一刻 React 会删掉 borderColor → 边框落回 currentColor（黑）。
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: chat.hairline,
          background: 'transparent',
          backgroundImage: chat.caretImage,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 6px center',
          backgroundSize: '10px 10px',
          color: 'inherit',
          maxWidth: 260,
        },
        graph: { display: 'flex', flexDirection: 'column', gap: 4 },
      // 依赖图行：去掉每行描边，改成对齐的两列 + 等宽数字；常态与悬停都不上底色。
        graphRow: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          border: 'none',
          borderRadius: 8,
          padding: '5px 8px',
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          lineHeight: '20px',
          textAlign: 'left',
          cursor: 'pointer',
        },
        arrow: { opacity: 0.45, fontSize: F.sm },
      // 展开行里的正文摘要：整行单行、行尾省略，全文挂在 title 上悬停可看。
        tlText: {
          flex: '1 1 auto',
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        },
      // 消息数去掉 marginLeft: auto 的右靠，落在两个胶囊之间（跟着 graphRow 的 8px 间距走）。
        count: { fontSize: F.sm, opacity: 0.6, fontVariantNumeric: 'tabular-nums' },
        timeline: {
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          margin: '2px 0 6px 14px',
          paddingLeft: 10,
          borderLeft: chat.separatorLine,
        },
        tlRow: { display: 'flex', gap: 8, fontSize: F.xs, opacity: 0.9 },
        tlTime: { fontVariantNumeric: 'tabular-nums', opacity: 0.75, flex: '0 0 auto' },
        empty: { border: chat.dashedBorder, borderRadius: 8, padding: '14px', opacity: 0.85, lineHeight: 1.7 },
      };

      exports.styles = styles;
      exports.chatStyles = chatStyles;

    });

    __define("./constants.js", (exports, __load) => {
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

      exports.STATE_URL = STATE_URL;
      exports.COMMAND_URL = COMMAND_URL;
      exports.ARBITER_STATE_URL = ARBITER_STATE_URL;
      exports.TEAM_LOG_URL = TEAM_LOG_URL;
      exports.TEAM_LOG_POLL_MS = TEAM_LOG_POLL_MS;
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

    __define("./chat/colors.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 群聊 tab：角色颜色。

      const { STATE_URL } = __load('./constants.js');
      const { React } = __load('./react.js');
      const { chat } = __load('./tokens.js');

      // 颜色与调色板的权威在宿主侧（lib/roleColor.js），随 /state 与角色一起下来
      // （roles[].color / rolePalette / leadColor）。下面这份只是回包之前的兜底，
      // 以及角色表里没有的成员（手工起的名字）用的散列调色板，顺序与宿主侧一致。
      const FALLBACK_LEAD = chat.purple;
      const FALLBACK_PALETTE = chat.palette;

      /** 同一个名字永远同一个颜色，不依赖角色表里都有谁。 */
      function hashedColor(name, palette) {
        const source = String(name ?? '');
        let hash = 0;
        for (const character of source) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
        return palette[hash % palette.length];
      }

      /** 把 /state 折成「谁 → 什么颜色」两张表：按 id、按成员名。
       * 成员名取自 roles[].memberName；老回包没有这个字段时退回「role id 去掉 presetPrefix」，
       * 与 memberNameForRole 同一条规则。 */
      function buildColors(payload) {
        const state = payload !== null && typeof payload === 'object' ? payload : {};
        const roles = Array.isArray(state.roles) ? state.roles : [];
        const palette =
          Array.isArray(state.rolePalette) && state.rolePalette.length > 0 ? state.rolePalette : FALLBACK_PALETTE;
        const lead = typeof state.leadColor === 'string' && state.leadColor.length > 0 ? state.leadColor : FALLBACK_LEAD;
        const prefix = typeof state.presetPrefix === 'string' ? state.presetPrefix : '';

        const byId = new Map();
        const byName = new Map();
      // 回包还没带 roles[].color 时（换了客户端、还没重启 dsh）按列表顺序取，
      // 与宿主侧 nextRoleColor（第一个没被占用的颜色）在常见情形下逐一对应。
        for (const [index, role] of roles.entries()) {
          if (role === null || typeof role !== 'object') continue;
          const id = String(role.id ?? '');
          const stored = typeof role.color === 'string' && role.color.length > 0 ? role.color : '';
          const color = stored.length > 0 ? stored : palette[index % palette.length];
          if (id.length > 0) byId.set(id, color);

          const declared = typeof role.memberName === 'string' ? role.memberName : '';
          const name =
            declared.length > 0
              ? declared
              : prefix.length > 0 && id.startsWith(prefix)
                ? id.slice(prefix.length)
                : id;
          if (name.length > 0) byName.set(name, color);
        }

        return {
          lead,
          palette,
      /** 角色表里认得的颜色；认不出来就按名字散列，绝不返回空。 */
          colorFor(id, name) {
            const byIdentifier = byId.get(String(id ?? ''));
            if (byIdentifier !== undefined) return byIdentifier;
            const byMemberName = byName.get(String(name ?? ''));
            if (byMemberName !== undefined) return byMemberName;
            return hashedColor(name ?? id, palette);
          },
        };
      }

      /** 读一次 /state 拿角色颜色；读不到就全按散列兜底，消息流照常渲染。 */
      function useRoleColors() {
        const [colors, setColors] = React.useState(() => buildColors(null));
        React.useEffect(() => {
          let alive = true;
          const load = async () => {
            try {
              const response = await fetch(STATE_URL, { headers: { accept: 'application/json' } });
              if (response.ok !== true) return;
              const payload = await response.json();
              if (alive === true) setColors(buildColors(payload));
            } catch (error) {
      // 拿不到颜色不是错误：散列兜底已经给了每个名字一个稳定颜色。
            }
          };
          void load();
          return () => {
            alive = false;
          };
        }, []);
        return colors;
      }

      exports.useRoleColors = useRoleColors;
      exports.buildColors = buildColors;
      exports.hashedColor = hashedColor;
      exports.FALLBACK_LEAD = FALLBACK_LEAD;
      exports.FALLBACK_PALETTE = FALLBACK_PALETTE;

    });

    __define("./chat/hooks.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 群聊 tab：投影与事件窗口 hook。

      const { TEAM_LOG_POLL_MS, TEAM_LOG_URL } = __load('./constants.js');
      const { React } = __load('./react.js');
      const { blockText } = __load('./chat/fold.js');

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
      // 没有 messages 的载荷不是投影：忽略，而不是把半个形状并进视图。
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

      exports.useTeamProjection = useTeamProjection;
      exports.shortText = shortText;
      exports.foldPairs = foldPairs;
      exports.useEventWindow = useEventWindow;

    });

    __define("./chat/order.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 消息流的阅读顺序：默认倒序（最新在上），↑/↓ 切换，选择记在本机。

      const { React, h } = __load('./react.js');
      const { chatStyles } = __load('./styles.js');

      const ORDER_KEY = 'dsh-agent-team-roles:chat-order';

      function readOrder() {
        try {
          return globalThis.localStorage?.getItem(ORDER_KEY) === 'asc' ? 'asc' : 'desc';
        } catch {
          // 读不到偏好不是错误：退回默认倒序，别的都不受影响。
          return 'desc';
        }
      }

      function writeOrder(order) {
        try {
          globalThis.localStorage?.setItem(ORDER_KEY, order);
        } catch {
          // 记不住也照样能排序：这一次会话内仍然按用户点的那一侧渲染。
        }
      }

      function useOrder() {
        const [order, setOrder] = React.useState(readOrder);
        const pick = (next) => {
          writeOrder(next);
          setOrder(next);
        };
        return [order, pick];
      }

      function orderButton(order, value, label, hint, onPick) {
        return h(
          'button',
          {
            type: 'button',
            style: { ...chatStyles.orderBtn, ...(order === value ? chatStyles.orderOn : {}) },
            title: hint,
            'aria-pressed': order === value,
            onClick: () => onPick(value),
          },
          label,
        );
      }

      function OrderSwitch(props) {
        return h(
          'div',
          { style: chatStyles.orderGroup },
          orderButton(props.order, 'asc', '↑ 正序', '按时间正序（早 → 晚）', props.onPick),
          orderButton(props.order, 'desc', '↓ 倒序', '按时间倒序（新 → 旧，默认）', props.onPick),
        );
      }

      exports.OrderSwitch = OrderSwitch;
      exports.useOrder = useOrder;

    });

    __define("./chat/markdown-style.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 群聊正文的 markdown 作用域样式，加两个小组件辅助（宿主滚动条复位、展开行取第一行）。

      const { blockText } = __load('./chat/fold.js');

      // 群聊正文的作用域样式（只作用于自己这张卡片里的 markdown）
      // 宿主 markdown 容器带 white-space: pre-wrap，段落又有 16px 上下外边距，一个空行被算两遍。
      // 这里只把块级元素外边距归零，pre-wrap 不动；选择器重复类名是为了压过宿主 CSS module 的权重。
      const MARKDOWN_CLASS = 'atr-chat-md';
      const MARKDOWN_CSS = `
      .atr-chat-md.atr-chat-md p,
      .atr-chat-md.atr-chat-md ul,
      .atr-chat-md.atr-chat-md ol,
      .atr-chat-md.atr-chat-md pre,
      .atr-chat-md.atr-chat-md blockquote,
      .atr-chat-md.atr-chat-md table,
      .atr-chat-md.atr-chat-md h1,
      .atr-chat-md.atr-chat-md h2,
      .atr-chat-md.atr-chat-md h3,
      .atr-chat-md.atr-chat-md h4,
      .atr-chat-md.atr-chat-md h5,
      .atr-chat-md.atr-chat-md h6 { margin: 0; }
      .atr-chat-md.atr-chat-md ul,
      .atr-chat-md.atr-chat-md ol { padding-left: 22px; }
      .atr-chat-md.atr-chat-md blockquote { padding-left: 10px; }
      .atr-chat-md.atr-chat-md li { margin: 0; }
      .atr-chat-md.atr-chat-md > :first-child { margin-top: 0; }
      .atr-chat-md.atr-chat-md > :last-child { margin-bottom: 0; }
      `;

      // 宿主的会话滚动条是所有页签共用的同一个 scrollBody，切页签不重置它。
      // 做法：本视图从隐藏转为可见那一刻，把最近的可滚动祖先拉回顶部；
      // 只在边沿做一次，用户自己在群聊里滚动不会被拽回去。
      function resetHostScroll(node) {
        if (node === null || node === undefined || typeof globalThis.getComputedStyle !== 'function') return;
        for (let el = node.parentElement; el !== null && el !== undefined; el = el.parentElement) {
          const overflowY = globalThis.getComputedStyle(el).overflowY;
          if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) {
            el.scrollTop = 0;
            return;
          }
        }
      }

      // 展开行的「完整标题」= 消息正文第一行；超出宽度由 CSS 省略，完整正文挂在 title 上。
      function firstLine(content) {
      // 正文常以空行开头（正文前一两个换行），那时第一行是空串、展开行会整行空白。
      // 先去掉开头的空白行再取第一行；整段没内容时保持原样。
        const text = blockText(content).replace(/^(?:[^\S\n]*\n)+/, '');
        const cut = text.indexOf('\n');
        return cut === -1 ? text : text.slice(0, cut);
      }

      exports.MARKDOWN_CLASS = MARKDOWN_CLASS;
      exports.MARKDOWN_CSS = MARKDOWN_CSS;
      exports.firstLine = firstLine;
      exports.resetHostScroll = resetHostScroll;

    });

    __define("./chat/empty-view.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 群聊页签的空态：这个窗口里没有群聊记录（可能只是没往前翻到）。

      const { h } = __load('./react.js');
      const { chatStyles, styles } = __load('./styles.js');

      // 窗口被截断时的空页签不能声称这个会话从没有过团队：要说清记录在哪，并提供往前翻。
      // 入参：truncated（窗口被截断）、scan（往前翻的记账）、runScan（再翻 N 段）。
      function TeamChatEmpty({ p }) {
        const { truncated, scan, runScan } = p;
        return h(
          'div',
          { style: chatStyles.root },
          h(
            'div',
            { style: chatStyles.empty },
            h('div', null, truncated ? '这个窗口里没有群聊记录。' : '本会话还没有群聊记录。'),
            truncated
              ? h(
                  'div',
                  { style: { marginTop: 8, opacity: 0.85 } },
                  '「群聊」读的是客户端已经缓存的这一段会话日志（约最近一千条），不是整份日志——' +
                    '团队活动发生在更早的时候，就不在这段窗口里。' +
                    (scan.rounds > 0 ? `已经往前翻了 ${scan.rounds} 段，还没翻到。` : ''),
                )
              : null,
            // — 往前翻失败不能静默：给一行可见提示，用户才知道是「读失败」而不是「翻到底了」。
            scan.error
              ? h(
                  'div',
                  { style: { marginTop: 8, ...chatStyles.note, ...chatStyles.failed } },
                  '往前翻失败，请稍后再试。',
                )
              : null,
            truncated
              ? h(
                  'div',
                  { style: { marginTop: 8, opacity: 0.85 } },
                  '新的团队消息（成员创建、@ 收发）会实时出现在这里；要找回更早的，就往前翻日志。',
                )
              : h(
                  'div',
                  { style: { marginTop: 8, opacity: 0.85 } },
                  '群聊消息来自 dsh 自带的「智能体团队」运行时——它随 dsh 安装提供。' +
                    '如果它还没开，去「设置 → 插件」里打开「智能体团队」（等价命令：' +
                    'dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-profile），' +
                    '重启 dsh 后让 Lead 用 spawn_teammate 创建成员并互发消息。',
                ),
            truncated
              ? h(
                  'div',
                  { style: { marginTop: 10 } },
                  h(
                    'button',
                    {
                      type: 'button',
                      style: styles.button,
                      disabled: scan.running,
                      onClick: () => runScan(8),
                    },
                    scan.running ? '往前翻…' : '往前翻日志找找（再翻 8 段）',
                  ),
                )
              : h(
                  'div',
                  { style: { marginTop: 8, opacity: 0.85 } },
                  '开启后这个 tab 会按会话日志顺序显示每个成员的收发消息（含送达状态与时间戳）。',
                ),
          ),
        );
      }

      exports.TeamChatEmpty = TeamChatEmpty;

    });

    __define("./chat/stats-row.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 群聊页签顶部：一行统计数字 + 成员名单 + 「加载更早的消息」。

      const { React, h } = __load('./react.js');
      const { chatStyles, styles } = __load('./styles.js');

      function TeamChatStats({ p }) {
        const { roster, shown, pending, folded, leadIds, colorOfRow, rosterChipStyle, onLoadOlder, busy } = p;
        return h(
          React.Fragment,
          null,
          h(
            'div',
            { style: chatStyles.header },
      // 一行「数字 + 标签」的 stat 块，不用通栏下划线分段。
            h(
              'span',
              { style: chatStyles.stat },
              h('span', { style: chatStyles.statValue }, roster.length),
              h('span', { style: chatStyles.statLabel }, '成员'),
            ),
            h(
              'span',
              { style: chatStyles.stat },
              h('span', { style: chatStyles.statValue }, shown.length),
              h('span', { style: chatStyles.statLabel }, '消息'),
            ),
            pending > 0
              ? h(
                  'span',
                  { style: chatStyles.stat },
                  h('span', { style: { ...chatStyles.statValue, ...chatStyles.pending } }, pending),
                  h('span', { style: chatStyles.statLabel }, '排队中'),
                )
              : null,
            folded.tasks.length > 0
              ? h(
                  'span',
                  { style: chatStyles.stat },
                  h('span', { style: chatStyles.statValue }, folded.tasks.length),
                  h('span', { style: chatStyles.statLabel }, '任务'),
                )
              : null,
            folded.hasMore ? h('span', { style: chatStyles.note }, '（历史未载完）') : null,
      // 常态不标注日志范围，只有「历史未载完」还留着（那是真没读完，属于提示而非标注）。
          ),
      // 顶部名单读的是合成后的 roster：Lead 是 Team 根会话、日志里没有它的 team/member 记录，
      // 合成的那一行不能被绕过（可见性、渲染、「成员」计数同一口径）。
          roster.length > 0
            ? h(
                'div',
                { style: chatStyles.roster },
                roster.map((member) =>
                  h(
                    'span',
                    {
                      key: String(member.id),
      // 顶部角色状态用自己的属性色做背景、白字。
                      style: rosterChipStyle(colorOfRow(member.id, member.name)),
                    },
                    `${member.name}${leadIds.has(String(member.id)) ? '（Lead）' : ''} · ${member.phase}`,
                  ),
                ),
              )
            : null,
          folded.hasMore
            ? h(
                'div',
                null,
                h(
                  'button',
                  { type: 'button', style: styles.button, onClick: onLoadOlder, disabled: busy },
                  busy ? '加载中…' : '加载更早的消息',
                ),
              )
            : null,
        );
      }

      exports.TeamChatStats = TeamChatStats;

    });

    __define("./chat/graph-view.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 群聊页签中段：角色依赖图（@ 周期选择 + 一对 mapping 一行 + 可展开的时间线）。

      const { React, h } = __load('./react.js');
      const { chatStyles, styles } = __load('./styles.js');
      const { T } = __load('./tokens.js');
      const { blockText, formatClock } = __load('./chat/fold.js');
      const { firstLine } = __load('./chat/markdown-style.js');

      function TeamChatGraph({ p }) {
        const {
          leadRows,
          cycleStart,
          cycleEnd,
          range,
          setRange,
          selectStyle,
          setFocusKey,
          pairs,
          inverted,
          expanded,
          togglePair,
          graphChipStyle,
          colorOfRow,
          nameById,
          leadIds,
        } = p;
        return h(
          React.Fragment,
          null,
          h('div', { style: chatStyles.sectionBar }, h('span', { style: chatStyles.sectionTitle }, '角色依赖图')),
          leadRows.length > 1
            ? h(
                'div',
                { style: chatStyles.controls },
      // 不显示「统计周期」四个字，「到」用一个短横线。
                h(
                  'select',
                  {
                    style: selectStyle('start'),
                    value: cycleStart === undefined ? '' : String(cycleStart.message.id),
                    onFocus: () => setFocusKey('start'),
                    onBlur: () => setFocusKey(null),
                    onChange: (event) =>
                      setRange({
                        startId: event.target.value,
                        endId: range !== null && range.endId ? range.endId : '',
                      }),
                  },
                  leadRows.map((row, index) =>
                    h(
                      'option',
                      { key: `start:${row.message.id}`, value: String(row.message.id) },
                      `第 ${index + 1} 次 @ · ${formatClock(row.time)}`,
                    ),
                  ),
                ),
                h('span', { style: chatStyles.controlLabel }, '-'),
                h(
                  'select',
                  {
                    style: selectStyle('end'),
                    value: range !== null && range.endId ? String(range.endId) : '',
                    onFocus: () => setFocusKey('end'),
                    onBlur: () => setFocusKey(null),
                    onChange: (event) =>
                      setRange({
                        startId: cycleStart === undefined ? '' : String(cycleStart.message.id),
                        endId: event.target.value,
                      }),
                  },
                  [h('option', { key: 'end:latest', value: '' }, '最新（含 @ 之后的回复）')].concat(
                    leadRows.map((row, index) =>
                      h(
                        'option',
                        { key: `end:${row.message.id}`, value: String(row.message.id) },
                        `第 ${index + 1} 次 @ · ${formatClock(row.time)}`,
                      ),
                    ),
                  ),
                ),
                range === null
                  ? null
                  : h(
                      'button',
                      { type: 'button', style: styles.button, onClick: () => setRange(null) },
                      '恢复默认（第一次 @ → 最新）',
                    ),
              )
            : null,
          pairs.length === 0
            ? h(
                'div',
                { style: { fontSize: T.font.xs, opacity: 0.7 } },
                inverted
                  ? '起始 @ 晚于结束 @，这个周期是空的——把两个下拉框对调一下。'
                  : '这个周期内还没有任何 @。',
              )
            : h(
                'div',
                { style: chatStyles.graph },
                pairs.map((pair) => {
      // 一对 mapping 一行：这一对里只要有 Lead，Lead 一律在左，两个数字跟着显示顺序（左数字 = 左→右）；
      // 两边都不是 Lead（成员↔成员）时沿用「发起方在左」。
                  const leftIsLead = leadIds.has(String(pair.leftId));
                  const rightIsLead = leadIds.has(String(pair.rightId));
                  const both = pair.out > 0 && pair.back > 0
                  // 只要有 Lead 且它在右，就翻过来；两边都不是 Lead 时沿用「发起方在左」。
                  const flip = rightIsLead || (!leftIsLead && !both && pair.out === 0);
                  const leftId = flip ? pair.rightId : pair.leftId
                  const leftName = flip ? pair.rightName : pair.leftName
                  const rightId = flip ? pair.leftId : pair.rightId
                  const rightName = flip ? pair.leftName : pair.rightName
                  const outCount = flip ? pair.back : pair.out
                  const backCount = flip ? pair.out : pair.back
                  const nameOf = (id) =>
                    id === pair.leftId ? pair.leftName : id === pair.rightId ? pair.rightName : nameById.get(id) ?? id
                  const title = both
                    ? `${leftName} → ${rightName} ${outCount} 条；${rightName} → ${leftName} ${backCount} 条`
                    : `${leftName} → ${rightName} ${pair.rows.length} 条`
      // 两个方向永远都报数字：单向的那一行写 @0 ⇄ @1，不用 → @n / ← @n 的省略写法。
                  const countText = `@${outCount} ⇄ @${backCount}`
                  return h(
                    'div',
                    { key: pair.key },
                    h(
                      'button',
                      {
                        type: 'button',
                        title,
      // 常态与悬停都不上底色，只保留描边为零的行式布局。
                        style: chatStyles.graphRow,
                        onClick: () => togglePair(pair.key),
                      },
                      h('span', { style: graphChipStyle(colorOfRow(leftId, leftName)) }, leftName),
                      h('span', { style: chatStyles.count }, countText),
                      h('span', { style: graphChipStyle(colorOfRow(rightId, rightName)) }, rightName),
                    ),
                    expanded.has(pair.key)
                      ? h(
                          'div',
                          { style: chatStyles.timeline },
                          pair.rows.map((row) =>
                            h(
                              'div',
                              { key: `${row.seq}:${row.message.id}`, style: chatStyles.tlRow },
                              h('span', { style: chatStyles.tlTime }, formatClock(row.time)),
      // 合并后的时间线里可能两个方向都有，用箭头标出这一条是谁 @ 谁。
                              both
                                ? h(
                                    'span',
                                    {
                                      style: { opacity: 0.7, flex: '0 0 auto' },
                                      title: `${nameOf(String(row.message.senderId))} → ${nameOf(String(row.message.targetId))}`,
                                    },
                                    String(row.message.senderId) === leftId ? '→' : '←',
                                  )
                                : null,
      // 不按字数硬切，取整条消息的第一行，由 CSS 在行尾省略；title 挂全文，悬停仍能看完整内容。
                              h(
                                'span',
                                { style: chatStyles.tlText, title: blockText(row.message.content) },
                                firstLine(row.message.content),
                              ),
                              h(
                                'span',
                                { style: row.delivered === true ? chatStyles.ok : chatStyles.failed },
                                row.delivered === true ? '已送达' : '排队中',
                              ),
                            ),
                          ),
                        )
                      : null,
                  )
                }),
              ),
        );
      }

      exports.TeamChatGraph = TeamChatGraph;

    });

    __define("./markdown.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 宿主自带的 markdown 渲染器：官方聊天正文用的就是 MarkdownText（@deepseek-ai/dsh-client-ui-primitives 导出，含样式表）。
      // 不自己写解析器，也不抄它的样式。构建器只允许相对 import，平台模块必须用 require 原样透传。
      // 老版本 dsh 没导出时保持 null，调用方退回纯文本，不白屏。

      const { h } = __load('./react.js');

      let MarkdownText = null;
      try {
        const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
      // 它是 memo(...) 的产物：typeof 是 object 不是 function，别用 typeof 判断，
      // 否则整段静默退回纯文本。
        const candidate = primitives === null || primitives === undefined ? undefined : primitives.MarkdownText;
        if (candidate !== undefined && candidate !== null) MarkdownText = candidate;
      } catch {
        MarkdownText = null;
      }

      // 宿主渲染器从 context.labels.code.copyLabel 读代码围栏复制按钮的文案；
      // 只传 text / variant 时 labels 是 undefined，渲染任意带代码围栏的正文即抛 TypeError，
      // 整个 conversation.view 插槽被错误边界摘掉（现象是群聊页签整片空白）。这里由插件自己补齐契约。
      const MARKDOWN_LABELS = {
        code: {
          copyLabel: '复制',
          copiedLabel: '已复制',
          // 代码卡片的标题栏：语言缺失时的标题 + 换行/不换行两个动作（`CodeToolbarLabels`）。
          toolbarLabels: { codeLabel: '代码', wrapLabel: '换行', unwrapLabel: '不换行' },
        },
        footnotes: '脚注',
      };

      // 统一入口：永远补上 labels，调用方不必知道宿主这份契约。
      const Markdown =
        MarkdownText === null
          ? null
          : function Markdown(props) {
              const labels = props.labels === undefined || props.labels === null ? MARKDOWN_LABELS : props.labels;
              return h(MarkdownText, { ...props, labels });
            };

      exports.Markdown = Markdown;
      exports.MarkdownText = MarkdownText;
      exports.MARKDOWN_LABELS = MARKDOWN_LABELS;

    });

    __define("./chat/message-list.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 群聊页签下半段：消息流（收发胶囊 + 送达状态 + 时间 + markdown 正文）。

      const { React, h } = __load('./react.js');
      const { chatStyles } = __load('./styles.js');
      const { OrderSwitch } = __load('./chat/order.js');
      const { Markdown } = __load('./markdown.js');
      const { blockText, formatClock } = __load('./chat/fold.js');
      const { MARKDOWN_CLASS } = __load('./chat/markdown-style.js');

      function TeamChatMessages({ p }) {
        const { ordered, order, pickOrder, colorOfRow, nameById, hoverKey, setHoverKey, fade, chipStyle } = p;
        return h(
          React.Fragment,
          null,
          h(
            'div',
            { style: chatStyles.sectionBar },
            h('span', { style: chatStyles.sectionTitle }, '消息流'),
            // ↑ / ↓ 点一下就换，当前生效的一侧高亮；默认倒序（最新在上）。
            h(OrderSwitch, { order: order, onPick: pickOrder }),
          ),
          h(
            'div',
            { style: chatStyles.list },
            ordered.map((row) => {
              const message = row.message;
      // 这一条的主色 = 发送者的角色色，整圈边框都用它；卡片底色与文字保持原样。
      // 收件人 chip 用收件人自己的角色色，两边不做层级区分。
              const senderColor = colorOfRow(message.senderId, message.senderName);
              const targetName = nameById.get(String(message.targetId));
              const targetColor = targetName === undefined ? null : colorOfRow(message.targetId, targetName);
      // 整圈边框仍是发送者色，但平时只到 40% 淡色，鼠标停留在这一条上才转实色。
              const rowKey = `${row.seq}:${message.id}`;
              return h(
                'div',
                {
                  key: rowKey,
                  style: {
                    ...chatStyles.message,
                    borderColor: hoverKey === rowKey ? senderColor : fade(senderColor, 0.4),
                  },
                  onMouseEnter: () => setHoverKey(rowKey),
                  onMouseLeave: () => setHoverKey(null),
                },
                h(
                  'div',
                  { style: chatStyles.meta },
                  h('span', { style: chipStyle(senderColor) }, message.senderName),
      // 箭头自己一格，夹在收发两个胶囊中间。
                  targetName === undefined ? null : h('span', { style: chatStyles.arrow }, '→'),
                  targetName === undefined ? null : h('span', { style: chipStyle(targetColor) }, targetName),
                  h(
                    'span',
                    { style: chatStyles.metaRight },
      // 时间固定淡紫，不跟状态色走；送达状态保持原样。
                    h('span', { style: chatStyles.time }, formatClock(row.time)),
                    h(
                      'span',
                      { style: row.delivered === true ? chatStyles.ok : chatStyles.failed },
                      row.delivered === true ? '已送达' : '排队中',
                    ),
                  ),
                ),
      // 正文交给宿主自己的 markdown 渲染器（官方聊天正文同款），拿不到就退回纯文本。
                Markdown === null
                  ? h('pre', { style: chatStyles.body }, blockText(message.content))
                  : h(
                      'div',
                      { className: MARKDOWN_CLASS, style: chatStyles.body },
                      h(Markdown, { text: blockText(message.content), variant: 'body' }),
                    ),
              );
            }),
          ),
        );
      }

      exports.TeamChatMessages = TeamChatMessages;

    });

    __define("./chat/view.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 群聊 tab 视图：只负责取数、算派生值与装配，四段渲染在 chat/ 下的兄弟模块。

      const { React, h } = __load('./react.js');
      const { chatStyles } = __load('./styles.js');
      const { chat, withAlpha } = __load('./tokens.js');
      const { useRoleColors } = __load('./chat/colors.js');
      const { foldTeamEvents, mergeTeamLog } = __load('./chat/fold.js');
      const { foldPairs, useEventWindow, useTeamProjection } = __load('./chat/hooks.js');
      const { useOrder } = __load('./chat/order.js');
      const { MARKDOWN_CSS, resetHostScroll } = __load('./chat/markdown-style.js');
      const { TeamChatEmpty } = __load('./chat/empty-view.js');
      const { TeamChatStats } = __load('./chat/stats-row.js');
      const { TeamChatGraph } = __load('./chat/graph-view.js');
      const { TeamChatMessages } = __load('./chat/message-list.js');
      function TeamChatView(props) {  const window = useEventWindow(props.subscribe, props.getWindow);
        const local = React.useMemo(() => foldTeamEvents(window), [window]);
      // 宿主对这条会话日志的投影：到得稍晚，也可能永远不到（运行时关着 / 会话不活跃），
      // 那时 mergeTeamLog 原样交回本地窗口折出来的结果。
        const projection = useTeamProjection(props.sessionId);
        const folded = React.useMemo(() => mergeTeamLog(local, projection), [local, projection]);
        const [busy, setBusy] = React.useState(false);
        const [expanded, setExpanded] = React.useState(() => new Set());
        const [range, setRange] = React.useState(null);
        const [order, pickOrder] = useOrder();
      // 角色颜色来自 /state 的角色表（角色自己 role.json 里那个 color）。
        const roleColors = useRoleColors();

      // 外壳给的只是会话日志的**有界尾巴**，不是整段对话；
      // 早前干过活的团队可能整个落在窗口之外，所以要靠宿主投影补回来。
        const loadOlderRef = React.useRef(props.loadOlder);
        loadOlderRef.current = props.loadOlder;
        const canPage = typeof props.loadOlder === 'function';
        const [scan, setScan] = React.useState({ running: false, rounds: 0, error: false });
        const runScan = (rounds) => {
          const load = loadOlderRef.current;
          if (typeof load !== 'function') return;
          setScan((current) => (current.running ? current : { running: true, rounds: current.rounds, error: false }));
      // 记账口径 = 实际往前翻成功的段数：load() 返回 false 表示到顶，抛错表示这次读失败，
      // 两种都不能按满 rounds 累加，否则「已经往前翻了 N 段」是假的。失败必须留下可见提示（scan.error）。
          let done = 0;
          const step = async (left) => {
            if (left <= 0) return 0;
            const changed = await load();
            if (changed === false) return 0;
            done += 1;
            return 1 + (await step(left - 1));
          };
          step(rounds).then(
            () => setScan((current) => ({ running: false, rounds: current.rounds + done, error: false })),
            () => setScan((current) => ({ running: false, rounds: current.rounds + done, error: true })),
          );
        };

      // team/member 记录是 TeamMemberSnapshot，不带 role 和 status：Lead 是 Team 根，TeamId 就是那个会话的 id。
        const leadId = folded.teamId === null ? props.sessionId : folded.teamId;
        const leadIds = new Set(leadId === null || leadId === undefined ? [] : [String(leadId)]);
        const nameById = new Map(folded.members.map((member) => [String(member.id), member.name]));
        for (const id of leadIds) if (nameById.has(id) !== true) nameById.set(id, 'lead');
      // Lead 是 Team 根会话，日志里永远没有它的 team/member 记录，缺的时候合出一行。
        const roster =
          leadId === null || leadId === undefined || folded.members.some((m) => String(m.id) === String(leadId))
            ? folded.members
            : [{ id: leadId, name: 'lead', phase: 'active' }, ...folded.members];

      // 颜色按「这个人是谁」取：Lead 固定深紫，其他角色用自己 role.json 里的颜色。
      // 发送者、收件人、依赖图两端都用同一种 chip：只有颜色不同，不分主次。
        const colorOfRow = (id, name) =>
          leadIds.has(String(id)) ? roleColors.lead : roleColors.colorFor(id, name);
        const chipStyle = (color) => ({ ...chatStyles.nameChip, background: color, color: chat.chipText });
      // 顶部成员名单用同一个 chip 形状，只是圆角更大（胶囊）。
        const rosterChipStyle = (color) => ({ ...chipStyle(color), borderRadius: 999, padding: '2px 10px' });
      // 消息卡整圈边框平时只到发送者色的 40%（线太密不精致），鼠标移到这一条上才转实色；
      // 依赖图行同理，平时无底色、悬停给极浅底色。调淡（含颜色字符串拼接）关在 tokens.js 里。
        const fade = withAlpha;
        const [hoverKey, setHoverKey] = React.useState(null);
      // 下拉框自绘（appearance:none）之后没有原生焦点外观了，焦点自己用边框深浅表示（0.28 → 0.6）。
        const [focusKey, setFocusKey] = React.useState(null);
        const selectStyle = (key) =>
          focusKey === key ? { ...chatStyles.select, borderColor: chat.focusRing } : chatStyles.select;

      // 默认周期 = 第一个 Lead @ → 最新一条消息，这样最后一条 @ 之后才到的成员回复不会被截掉。
      // 两个 @ 选择器只能点名 Lead @ 点，「最新」因此是它自己的空选项值。
        const leadRows = folded.messages.filter((row) => leadIds.has(String(row.message.senderId)));
        const latest = folded.messages[folded.messages.length - 1];
        const boundRow = (messageId, fallback) =>
          messageId === undefined || messageId === null || messageId === ''
            ? fallback
            : leadRows.find((row) => row.message.id === messageId) ?? fallback;
        const cycleStart = boundRow(range === null ? undefined : range.startId, leadRows[0]);
        const cycleEnd = boundRow(range === null ? undefined : range.endId, latest ?? leadRows[leadRows.length - 1]);
        const startSeq = cycleStart === undefined ? Number.NEGATIVE_INFINITY : cycleStart.seq;
        const endSeq = cycleEnd === undefined ? Number.POSITIVE_INFINITY : cycleEnd.seq;
      // 两个 @ 选择器互相独立，「起点晚于终点」可达；那一段确实为空，要明说，
      // 而不是渲染成看起来整个会话都没消息的空白页签。
        const inverted = Number.isFinite(startSeq) && Number.isFinite(endSeq) && startSeq > endSeq;
        const shown = inverted ? [] : folded.messages.filter((row) => row.seq >= startSeq && row.seq <= endSeq);
      // 只改渲染顺序：统计、@ 配对、翻页仍按时间正序处理 shown。
        const newestFirst = order !== 'asc';
        const ordered = newestFirst ? [...shown].reverse() : shown;
        const pairs = foldPairs(shown, nameById);
      // 按这一屏出现过的角色名估一个统一宽度（中日韩按 13px、其他按 7.5px，再加左右内边距），
      // 短的留白、长的不换行。只在依赖图里用，顶部成员胶囊保持自然宽度。
        const estimateChipWidth = (name) => {
          let width = 0;
          for (const ch of String(name)) width += ch.codePointAt(0) > 0x2e80 ? 13 : 7.5;
          return width + 20;
        };
        const graphChipNames = new Set(['Lead']);
        for (const pair of pairs) {
          graphChipNames.add(pair.leftName);
          graphChipNames.add(pair.rightName);
        }
        const graphChipWidth = Math.ceil(Math.max(56, ...[...graphChipNames].map(estimateChipWidth)));
        const graphChipStyle = (color) => ({
          ...chipStyle(color),
          width: graphChipWidth,
          boxSizing: 'border-box',
          textAlign: 'center',
        });
        const pending = shown.filter((row) => row.delivered !== true).length;

        const togglePair = (key) => {
          setExpanded((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
        };

        const onLoadOlder = () => {
          if (typeof props.loadOlder !== 'function' || busy) return;
          setBusy(true);
          Promise.resolve(props.loadOlder()).then(
            () => setBusy(false),
            () => setBusy(false),
          );
        };

      // 初次挂载什么都没看到时自动往前翻一次；宿主投影已经答过就不必翻
      // （它从第一条事件折起，hasMore 是 false）。
        const teamSeen = folded.messages.length > 0 || folded.members.length > 0;
        const autoScan = React.useRef(false);
        const runScanRef = React.useRef(runScan);
        runScanRef.current = runScan;
        React.useEffect(() => {
          if (autoScan.current || teamSeen || canPage !== true || folded.hasMore !== true) return;
          autoScan.current = true;
          runScanRef.current(8);
        }, [canPage, folded.hasMore, teamSeen]);

      // 群聊页签「打开就在最上面」：宿主所有页签共用同一根滚动条（scrollBody），切页签不重置它，
      // 群聊于是停在上次读到的位置。本视图每次显示都重新挂载，所以在 layout effect 里、首帧绘制之前
      // 把最近的可滚动祖先拉回顶部：没有可见跳动，也不跟正在阅读的人抢（挂载只发生一次）。
        const rootRef = React.useRef(null);
        React.useLayoutEffect(() => {
          const node = rootRef.current;
          if (node === null || node === undefined) return;
          resetHostScroll(node);
        }, []);
        if (folded.messages.length === 0 && folded.members.length === 0) {
      // 窗口被截断时的空页签不能声称这个会话从没有过团队：要说清记录在哪，并提供往前翻。
          const truncated = canPage === true && folded.hasMore === true;
          return h(TeamChatEmpty, { p: { truncated, scan, runScan } });
        }

      // 算出来的值打包成 p 交给四段渲染模块，各模块内部再解构回原名；搬过去的渲染代码不改。
        const p = {
          roster, shown, pending, folded, leadIds, colorOfRow, rosterChipStyle, onLoadOlder, busy,
          leadRows, cycleStart, cycleEnd, range, setRange, selectStyle, setFocusKey,
          pairs, inverted, expanded, togglePair, graphChipStyle, nameById,
          ordered, order, pickOrder, hoverKey, setHoverKey, fade, chipStyle,
        };

        return h(
          'div',
          { ref: rootRef, style: chatStyles.root },
      // 宿主 markdown 容器带 white-space: pre-wrap，段落又有 16px 上下外边距，同一个空行被算两遍（实测块间距 56px）。
      // 这里只把块级元素外边距归零（pre-wrap 保留，单换行折行不受影响），块间距回到「一个空行 = 一行高」。
      // 用重复类名提高选择器权重，压过宿主 CSS module 的同权重规则。
          h('style', { key: 'atr-md-css' }, MARKDOWN_CSS),
          h(TeamChatStats, { p }),
          h(TeamChatGraph, { p }),
          h(TeamChatMessages, { p }),
        );
      }
      //#endregion

      exports.TeamChatView = TeamChatView;

    });

    __define("./entries.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // 能力表行抽取与过滤（MCP / 技能 / 工具）。

      const chatTab = {
        disposer: null,
        hidden: null,
      /** 当前会话住在监察员工作区里 → 这个「群聊」页签让位给 dsh-arbiter-roles 的「监察群」
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

      exports.chatTab = chatTab;
      exports.needleMatches = needleMatches;
      exports.mcpEntries = mcpEntries;
      exports.skillEntries = skillEntries;
      exports.toolEntries = toolEntries;
      exports.filterEntries = filterEntries;
      exports.TOOL_GROUP_MIN = TOOL_GROUP_MIN;
      exports.toolPrefix = toolPrefix;
      exports.groupTools = groupTools;

    });

    __define("./net.js", (exports, __load) => {
      // 客户端真源码（lib/client.js 是构建产物，勿手改）。
      // HTTP 层：超时、重试、命令节流、状态读取。

      const { COMMAND_URL, GET_ATTEMPTS, ARBITER_STATE_URL, REQUEST_TIMEOUT_MS, RETRY_BACKOFF_MS, STATE_URL } = __load('./constants.js');

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

      /** 群聊页签可隐藏：开关在设置文档里（settings.hideChatTab），宿主侧说该有才挂载。
       * 隐藏与显示走 slot 自己的 disposer，设置面板能切而不用刷页面。
       * 契约：加页签永远不能影响别的。 */

      /** 监察员工作区：只读 dsh-arbiter 自己 /state 上的 workspaceDir，不在这里另配路径。
       * 读不到就抛，由调用方 fail open（照旧显示群聊）。
       * @returns {Promise<string>} 目录（配置还没解析出来时可能是空串）。 */
      async function fetchArbiterWorkspace() {
        const response = await requestWithRetry(ARBITER_STATE_URL, { headers: { accept: 'application/json' } });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error((payload && payload.error) || `HTTP ${response.status}`);
        const dir = payload && typeof payload.workspaceDir === 'string' ? payload.workspaceDir : '';
        return dir.trim();
      }

      exports.timedFetch = timedFetch;
      exports.requestWithRetry = requestWithRetry;
      exports.inflightCommands = inflightCommands;
      exports.command = command;
      exports.fetchState = fetchState;
      exports.fetchArbiterWorkspace = fetchArbiterWorkspace;

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
      const { chatTab } = __load('./entries.js');
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

      // R6 — 会话页签跟随开关实时变化：隐藏 / 显示走 slot 的 disposer，不用重载。
        const hideChatTab = state === null ? undefined : state.hideChatTab;
        React.useEffect(() => {
          if (hideChatTab === undefined) return;
          chatTab.setHidden(hideChatTab === true);
        }, [hideChatTab]);

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
          hideChatTab,
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
                // 该 provider 一个模型都列不出来时先不动：宿主会拒「只给 provider」，
                // 让用户自己在下拉下面手填模型 id。
                if (!Array.isArray(first.models) || first.models.length === 0) return;
                onSet({ provider: first.id, model: first.models[0].id, reasoningEffort: '' });
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
                      // 新 provider 列不出模型时只换 provider 会被宿主拒绝，保持原样等手填。
                      if (next === undefined || next.models.length === 0) return;
                      onSet({ provider: event.target.value, model: next.models[0].id, reasoningEffort: '' });
                    },
                  },
                  providers.length === 0
                    ? h('option', { key: model.provider, value: model.provider }, model.provider)
                    : providers.map((entry) =>
                        h('option', { key: entry.id, value: entry.id }, `${entry.label}（${entry.id}）`),
                      ),
                ),
                models.length === 0
                  ? h('input', {
                      style: styles.input,
                      type: 'text',
                      placeholder: '模型 id（清单读不到，手填）',
                      defaultValue: model.model,
                      disabled: busy,
                      title: 'model',
                      onBlur: (event) => {
                        const value = String(event.target.value ?? '').trim();
                        if (value.length === 0 || value === model.model) return;
                        onSet({ ...model, model: value, reasoningEffort: '' });
                      },
                    })
                  : h(
                      'select',
                      {
                        style: styles.select,
                        value: model.model,
                        disabled: busy,
                        title: 'model',
                        onChange: (event) => onSet({ ...model, model: event.target.value, reasoningEffort: '' }),
                      },
                      models.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.label ?? entry.id)),
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
          h(
            'label',
            { style: styles.row },
            h('input', {
              type: 'checkbox',
              checked: state.hideChatTab !== true,
              disabled: busy || state.hideChatTab === undefined,
              onChange: (event) => run({ action: 'set-hide-chat-tab', enabled: !event.target.checked }),
            }),
            '在会话页签里显示「群聊」',
            info(
              state.hideChatTab === undefined ? 'hostStale' : 'chatTab',
              state.hideChatTab === undefined
                ? '宿主侧还没重启，重启 dsh 后这个开关才可用。'
                : '关掉后群聊 tab 不再出现，配置与视图都还在；改完立即生效，不用刷新。',
            ),
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

      const { foldTeamEvents } = __load('./chat/fold.js');
      const { TeamChatView } = __load('./chat/view.js');
      const { chatTab } = __load('./entries.js');
      const { command, fetchArbiterWorkspace, fetchState } = __load('./net.js');
      const { TeamRolesSection } = __load('./section/team-roles.js');

      const name = 'dsh-agent-team-roles';
      const inject = ['slots', 'sessions'];

      function apply(ctx) {
      // 角色配置页放在会话页签栏，和「群聊」并排（同一个 conversation.view 插槽，排在群聊之后）。
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

      // 把团队群聊挂成「对话」/「轨迹」之外的一个页签，并允许用户隐藏：挂载前读 settings.hideChatTab。
        chatTab.mount = () => {
          if (chatTab.disposer !== null || chatTab.stopped) return
          chatTab.disposer = ctx.slots.inject('conversation.view', () =>
            ctx.slots.register(
              {
                name: 'conversation.view',
                id: 'team-chat',
                order: 20,
                label: () => '群聊',
                inject: (sessionId) => {
                  const session = ctx.sessions.binding(sessionId)?.session;
                  if (session === undefined) {
                    throw new Error(`dsh-agent-team-roles: session "${sessionId}" is unavailable`);
                  }
                  const source = session.eventSource;
                  return {
                    sessionId,
                    subscribe: (listener) => source.subscribe(listener),
                    getWindow: () => source.getSnapshot(),
                    loadOlder:
                      typeof session.loadOlder === 'function'
                        ? async () => {
                            const before = source.getSnapshot();
                            await session.loadOlder();
                            return source.getSnapshot() !== before;
                          }
                        : undefined,
                  };
                },
              },
              TeamChatView,
            ),
          )
        };
        chatTab.unmount = () => {
          if (chatTab.disposer === null) return
          chatTab.disposer()
          chatTab.disposer = null
        };

      // 普通会话看群聊、监察员工作区看监察群：进了监察员工作区就把这个页签卸掉，让位给 dsh-arbiter-roles。
      // 判据只有一个来源——dsh-arbiter 自己 /state 的 workspaceDir；读不到就 fail open，不因一次失败藏掉页签。
        ctx.effect(() => {
          let arbiterDir = ''
          const normalize = (value) => {
            if (typeof value !== 'string') return ''
            let text = value.trim().replace(/\\/gu, '/')
            while (text.length > 1 && text.endsWith('/')) text = text.slice(0, -1)
            return text.toLowerCase()
          }
      /** 当前会话是否已经在监察员工作区里（读不到时一律 false）。 */
          const syncWith = (current) => () => {
            let sessionId
            try {
              sessionId = current?.getSnapshot?.()?.key
            } catch {
              sessionId = undefined
            }
            const wanted = normalize(arbiterDir)
            let cwd = ''
            try {
              cwd = normalize(ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd)
            } catch {
              cwd = ''
            }
      // 末段同名也算同一个工作区（盘符或挂载点不同不影响），与 dsh-arbiter 一致。
            const inside =
              wanted !== '' && cwd !== '' && (cwd === wanted || cwd.split('/').pop() === wanted.split('/').pop())
            chatTab.setOutOfScope(inside)
          }
      // uiSession 由别的插件提供，比本插件晚就绪是常态：ctx.get 那一刻还是 undefined，
      // 订阅就永远建不起来。用 ctx.inject 等它就绪，服务重建时 cordis 会重新执行这一段。
          let sync = () => {}
          let scopeStop = null
          ctx.inject(['uiSession'], (scoped) => {
            const current = scoped.uiSession?.adapter?.current
            sync = syncWith(current)
            const disposers = []
            if (current && typeof current.subscribe === 'function') disposers.push(current.subscribe(sync))
            try {
              if (typeof ctx.sessions?.list?.subscribe === 'function') disposers.push(ctx.sessions.list.subscribe(sync))
            } catch {
      // 会话表不可订阅时只靠当前会话的变化，够用。
            }
            scopeStop = () => {
              for (const off of disposers) {
                try {
                  off()
                } catch {
      // 退订失败不该影响卸载。
                }
              }
            }
            sync()
            return () => {
              scopeStop = null
              sync = () => {}
              for (const off of disposers) {
                try {
                  off()
                } catch {
      // 退订失败不该影响卸载。
                }
              }
            }
          })
          fetchArbiterWorkspace().then(
            (dir) => {
              arbiterDir = dir
              sync()
            },
            () => {
              arbiterDir = ''
              sync()
            },
          )
          sync()
          return () => {
            if (scopeStop !== null) scopeStop()
          }
        }, 'dsh-agent-team-roles: chat tab scope')

        ctx.effect(() => {
          chatTab.stopped = false
          fetchState().then(
            (state) => {
              if (!chatTab.stopped) chatTab.setHidden(state.hideChatTab === true)
            },
            () => {
      // fail open：多显示一个不该显示的页签可恢复，因一次读取失败而藏掉用户想要的页签不可恢复。
              if (!chatTab.stopped) chatTab.setHidden(false)
            },
          )
          return () => {
            chatTab.stopped = true
            chatTab.unmount()
          }
        }, 'dsh-agent-team-roles: team chat view')

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
