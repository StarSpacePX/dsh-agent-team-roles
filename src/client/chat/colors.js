// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 群聊 tab：角色颜色。

import { STATE_URL } from './../constants.js';
import { React } from './../react.js';
import { chat } from './../tokens.js';

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

export { useRoleColors, buildColors, hashedColor, FALLBACK_LEAD, FALLBACK_PALETTE };
