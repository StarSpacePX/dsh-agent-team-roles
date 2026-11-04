// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// HTTP 层：超时、重试、命令节流、状态读取。

import { COMMAND_URL, GET_ATTEMPTS, ARBITER_STATE_URL, REQUEST_TIMEOUT_MS, RETRY_BACKOFF_MS, STATE_URL } from './constants.js';

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

/**
 * §E1 — 幂等请求的有限重试。只重试"可能自己好起来"的失败：网络层错误（fetch
 * 直接抛）与 5xx。4xx 立刻抛出去（重试同样的请求只会得到同样的拒绝），
 * 非幂等请求只试一次，绝不替用户重放一次变更。
 *
 * @param {string} url
 * @param {object} [init]
 * @returns {Promise<Response>}
 */
async function requestWithRetry(url, init = {}) {
  const method = String(init.method || 'GET').toUpperCase();
  const idempotent = method === 'GET' || method === 'HEAD';
  const attempts = idempotent ? GET_ATTEMPTS : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
    const last = attempt === attempts - 1;
    try {
      const response = await timedFetch(url, init);
      // 最后一次尝试无论结果如何都交回给调用方：5xx 的响应体里有服务端给的
      // 错误原文，直接 `new Error('HTTP 503')` 会把它丢掉。
      if (!idempotent || response.status < 500 || last) return response;
    } catch (error) {
      if (last) throw error;
    }
  }
  // 循环里每次都以 return 或 throw 结束，这一行只是给静态检查一个收敛点。
  throw new Error(`HTTP 请求失败：${method} ${url}`);
}

/**
 * §E1 — 同一份变更在途时，重复点击不再发第二条请求。key 里带上整个 body：
 * 只按 `action` 去重会把「开关 A 在途、用户又点了开关 B」的第二条**变更**
 * 当成重复丢掉 —— 那是真的丢数据，比重复发一条更糟。
 */
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

/** @returns {Promise<object>} the host half's current state. */
async function fetchState() {
  const response = await requestWithRetry(STATE_URL, { headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error((payload && payload.error) || `HTTP ${response.status}`);
  return payload;
}

/**
 * R6 — the 「群聊」 tab is hideable.
 *
 * The switch lives in the settings document (`settings.hideChatTab`), so the
 * tab is mounted only after the host half has said it should exist. Hiding
 * and showing go through the slot's own disposer, which means the settings
 * panel can flip it with no page reload (`apply()` wires mount / unmount).
 *
 * Contract: adding a tab must never be able to break a session view, so a
 * state read that fails **fails open** — the tab is shown.
 */

/**
 * 「监察员工作区」——**只读** dsh-arbiter 自己 `/state` 上的 `workspaceDir`
 * （用户 m01040：那是设置里已经有的功能，不在这里另配路径）。读不到就抛，
 * 由调用方 fail open（照旧显示群聊）。
 *
 * @returns {Promise<string>} 目录（配置还没解析出来时可能是空串）。
 */
async function fetchArbiterWorkspace() {
  const response = await requestWithRetry(ARBITER_STATE_URL, { headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error((payload && payload.error) || `HTTP ${response.status}`);
  const dir = payload && typeof payload.workspaceDir === 'string' ? payload.workspaceDir : '';
  return dir.trim();
}

export { timedFetch, requestWithRetry, inflightCommands, command, fetchState, fetchArbiterWorkspace };
