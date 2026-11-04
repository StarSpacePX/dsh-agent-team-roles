# ui.test.mjs：从「源码字符串」改写成「行为」断言

改的是什么：`tests/plugin/ui.test.mjs` 原来 21 条断言全部是
`readFile(new URL('../../lib/client.js', import.meta.url))` + 正则 / `includes`
去匹配**客户端源码文本**。它盯的是「代码里写着什么」，不是「界面上发生什么」——
真出事故时（群聊白屏、设置页表单全空）这类断言照样全绿。

改成：用 `tests/support/client-runtime.mjs` 的 `mountPanel()` 把**真的 `lib/client.js`**
装进假宿主里跑（假 React、假 fetch、真渲染树），只断言**用户看得到的东西**和
**真发出去的请求**。改完 `ui.test.mjs` 里再没有一处 `readFile`，也没有正则匹配源码。

## 1. 改写映射（旧 21 条 → 新 11 条）

| 旧断言（§ 编号 + 标题） | 现在怎么验 |
| --- | --- |
| §5.55 插件清单夹在 MCP 与技能之间 | `S1`：挂载后按渲染文本里三块的**出现顺序**断言 |
| §5.55 过滤框与计数覆盖 MCP/技能/插件 | `S2`：改过滤框的 `onChange`，断言「共 7 行 · 显示 1」与「（显示 1 / 共 2）」跟着变，清空后徽标消失 |
| §5.55 同前缀工具并成一组 + 一个全选框 | `S3`：点开面板 → 断言组头「ego（3 个）」、成员行默认收起；勾组头 → 断言**真发出的 `/command`** 里恰好是 `ego_click/hover/wait`，没有 `other_tool` |
| §5.48 合成的 Lead 行必须被 roster 消费 | `C1`：挂群聊视图 → 断言「2 成员」「lead（Lead） · active」 |
| §5.51 双向依赖折成一行 | `C2`：断言「@2 ⇄ @1」与那一行的 `title` 文案 |
| §5.51 行上两个计数 + 时间线写谁 @ 谁 | `C2`（同上，`title` 里两侧条数） |
| §5.48 展开行标题跳过开头空行 | `C2`：点开依赖行 → 断言带完整正文的节点第一行是「真实标题」 |
| §5.48 往前翻只按真翻动的段数记账 | `C4`：`loadOlder` 返回 `true` ×8 → 断言「已经往前翻了 8 段」；返回 `false` → 断言空态且**没有**段数；抛错 → 断言「往前翻失败，请稍后再试。」且按钮仍可点 |
| §5.67 正文永远把 labels 交给宿主渲染器 | `C5`：注入一个「缺 labels 就抛」的假 `MarkdownText`，断言它拿到 `variant:'body'`、`text`、`labels.code.copyLabel='复制'`；没有宿主渲染器时退回 `<pre>` 纯文本 |
| §5.66 正文不再为空行付两次钱 | `C5`：断言渲染出的 `<style>` 节点里块级元素 `margin: 0` |
| §5.68 打开群聊把宿主滚动条拉回顶部 | `C6`：给宿主滚动容器 `scrollTop:480 / scrollHeight:1000` → 挂载后断言变 `0`；本来滚不动的容器（`scrollHeight==clientHeight`）断言**没被碰** |
| §5.49 点一个技能只灰一行、连点合并成一条请求 | `S4`：勾三下 → 断言被点的行 `disabled`、没点的行不灰、`commandCalls === 1` 且三个名字都在同一条请求里 |
| （新增）消息流排序 | `C3`：默认倒序（「较晚」在上）→ 点「↑ 正序」翻转 → 断言 `localStorage` 里记下 `asc`，重开群聊仍是正序 |
| （新增）宿主投影与本地窗口合并 | `C7`：注入投影（`m1` seq=10 已送达、`m2` seq=5）→ 断言两条都并进来、同一条不重复、正序时 seq 小的在前、已送达不被翻回「排队中」 |

## 2. 删掉的 8 条（都是纯样式 / 纯机制，源码里写着数字证明不了界面好看）

| 删掉的旧断言 | 为什么删 |
| --- | --- |
| §5.55 部署 roster 启动后预热一次、不占请求路径（`TEAM_WARMUP_DELAY_MS 2000`） | 机制细节（内部定时器），用户看不到 |
| §5.55 同一分类里没有行相对兄弟多缩进 | CSS 数值 |
| §5.55 覆盖标记画直线、不是「括号样」的 inset 阴影 | `box-shadow` 外观 |
| §5.59 群聊按角色上色、投递绿/红 | 颜色值（**文案**部分保留在 `C7`：已送达 / 排队中） |
| §5.60 五个配色与版式要求 | 颜色与间距数值 |
| §5.61 丢掉多余规则、收紧节奏 | CSS 规则条数 |
| §5.62 统计项有框、周期条没有框 | 有无边框（外观） |
| §5.63 两个周期下拉是自绘、不是原生 select | `appearance:none` 这种写法 |

这几条要回归只能靠**看**（截图 / 真机），源码断言挡不住也不该挡。
已知代价：以后改样式没人拦，改完请按 `docs/` 里的界面说明自己看一眼。

## 3. 验收（Lead 复跑，命令与真实输出）

- `node --test tests/plugin/ui.test.mjs` → **11 pass / 0 fail / duration_ms 1143.1075**，exit 0
- 插件根 `npm test`（含 `build-client --check` + 全部测试 + `extract-template/--deployment --check`）→ **267 pass / 0 fail / duration_ms 15111.6005**，exit 0
- `node tools/build-client.mjs --check` → `--check: lib\client.js 与 src/client/** 一致（29 modules）`
- `grep readFile tests/plugin/ui.test.mjs` → 0 处；`lib/**`、`src/**` 未改（改完 `git status` 只有两个测试文件）

## 4. 变异证据（改坏真行为 → 新断言必须红，随后已还原）

| 变异 | 结果 |
| --- | --- |
| `src/client/chat/view.js`：`const ordered = newestFirst ? [...shown].reverse() : shown;` → 正序分支也 `.reverse()` | C7 红：`AssertionError: 正序时 seq 小的应该排在前面`，`ui.test.mjs:378` |
| `src/client/chat/fold.js`：`delivered: row.delivered === true \|\| existing.delivered === true` → 只看本地 | C7 红：文本里出现「排队中 本地看到的」，`ui.test.mjs:380` |
| （附带）`fold.js` 的合并排序 `(left.seq) - (right.seq)` 反过来 | C7 红：`AssertionError: 同一条消息出现了两次`，`ui.test.mjs:372` |

三次都先 `node tools/build-client.mjs` 重建 `lib/client.js` 再跑，跑完 `Copy-Item` 还原源码 +
重建 + `--check` 确认与 `src/**` 一致（exit 0），`git status` 干净。

## 5. 顺带改的测试运行时（`tests/support/client-runtime.mjs`）

为了能挂群聊视图（原来只挂设置页），补了：`useLayoutEffect`、宿主节点 `ref` 真的指到节点、
`decorateHost` 钩子、`unmount()` 换根组件前收干净（否则设置页的定时器留在事件循环里、
`node --test` 退不出去）、`panel.mountChat()` 与 `panel.registration(s)`、
`/api/dsh-agent-team-roles/team-log` 的默认可选回包、可选 `localStorage` / `getComputedStyle` /
`@deepseek-ai/dsh-client-ui-primitives` 假实现。其余用到它的测试（p0-client / p1-client /
panels / style-tokens 等）在 `npm test` 里 267 条全绿。
