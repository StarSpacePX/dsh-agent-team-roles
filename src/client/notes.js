// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// notes.json 说明文案层（说明是数据，不是字面量）。

import { h } from './react.js';
import { styles } from './styles.js';

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

export { noteValues, describe, info, note, section, setNoteValues };
