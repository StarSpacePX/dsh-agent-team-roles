// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// 角色 id 规范化（用户输入 → `team-xxx`）。


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


export { roleIdFromInput };
