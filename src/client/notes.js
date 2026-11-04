// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// notes.json 说明文案层（说明是数据，不是字面量）。

import { h } from './react.js';
import { styles } from './styles.js';

/**
 * 「配置对应的说明是不是也可以做成一个配置映射文件？这样就可以集中修改」.
 *
 * So the text below is a *lookup*, not a literal: the host half reads
 * `notes.json` (next to `roles.json`) on every `/state` and sends the merged
 * map as `notes.values`; the string kept in this file is only the fallback
 * for a key the mapping does not have. Editing one json line changes the
 * panel — no restart, no code edit.
 */
let noteValues = {};
const describe = (key, fallback, args) => {
  const raw = typeof noteValues[key] === 'string' && noteValues[key].length > 0 ? noteValues[key] : fallback;
  if (typeof raw !== 'string') return '';
  if (args === undefined) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name) => (name in args ? String(args[name]) : match));
};

/**
 * 「其他的配置说明用悬浮显示」。
 *
 * Every explanation lives in the ⓘ below: a small circle whose `title` is the
 * text. Native
 * tooltip on purpose — no extra state, no portal, and it cannot get stuck
 * open when the panel re-renders under the pointer (which happens on every
 * refresh).
 *
 * `extra` 是**运行时才算得出来的那几句**（例如当前模式来自哪个文件）：
 * 它必须接在解析完的说明后面，不能塞进 `fallback` —— notes.json 里有同名键时
 * `describe` 会用那份 json 的文本、把 `fallback` 整段丢掉，塞进去的话一改 json 就没了。
 */
const info = (key, fallback, args, extra) => {
  const text = note(describe(key, fallback, args), extra);
  return h('span', { style: styles.info, title: text, 'aria-label': text, role: 'img' }, 'i');
};
/** Join the parts of an explanation, dropping the empty ones. */
const note = (...parts) => parts.filter((part) => typeof part === 'string' && part.length > 0).join('\n');
/** One prominent heading per configuration block, 说明收进 ⓘ（`extra` 见 `info`）。 */
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
