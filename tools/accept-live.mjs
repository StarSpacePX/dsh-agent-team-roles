// accept-live.mjs — 真机浏览器验收：用 agent 浏览器打开运行中的 DSH Web GUI，
// 只读跑 7 组断言（加载 / 群聊 tab / 消息流排序 / 设置里的角色面板 / 面板文案 / 不卡加载 / 控制台地雷），失败留截图。
// 不启动第二个 dsh 实例、不重启任何进程、不 POST /command。
// 用法：node tools/accept-live.mjs [--log <path>] [--base <url>] [--shot <dir>]
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PLUGIN_ROOT, '..', '..');
const TEST_DIR = path.join(REPO_ROOT, 'Test');
const LOG_DIR = path.join(PLUGIN_ROOT, 'logs');
const DEFAULT_DSH_LOG = path.join(REPO_ROOT, 'Start', 'logs', 'dsh.log');
const DEFAULT_BASE = 'http://127.0.0.1:3080';
const DRIVER = path.join(
  os.homedir(),
  '.dsh', 'profiles', 'web', 'node_modules', 'dsh-ego-browser',
  'runtime', 'ego-linux', 'bin', 'ego-browser.mjs',
);
// ego 的 Linux 运行时用 where 找不到 Windows 版 Chrome，直接给绝对路径（否则要用户设 EGO_LINUX_CHROME）。
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

// 断言 4 要求出现的文案。「中文名，如：架构师」只作为输入框 placeholder 存在；「角色（2）」是全角 ——
// 比对前统一去空白、全角括号折半角，两种写法都能命中。
const PANEL_TEXTS = [
  '启用智能体团队',
  '在会话页签里显示「群聊」',
  '中文名，如：架构师',
  '角色 ID',
  '新建角色',
  '保存角色信息',
  '全部还原',
  '删除角色',
  '模式',
  '角色 (',
];
const DRIVER_TIMEOUT_MS = 180_000;

/** 解析命令行；--base / --log / --shot 是便于排查与故障注入的旋钮。 */
function parseArgs(argv) {
  const opts = { base: DEFAULT_BASE, log: DEFAULT_DSH_LOG, shot: 'accept-live.png', help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') opts.base = argv[++i];
    else if (a === '--log') opts.log = argv[++i];
    else if (a === '--shot') opts.shot = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return opts;
}

/** 从启动日志读带 token 的 URL；读不到就给出可读原因（绝不静默）。 */
function readTokenUrl(logPath) {
  if (!fs.existsSync(logPath)) throw new Error('启动日志不存在：' + logPath + '（用 --log 指定，或先跑 Start\\restart-all.ps1）');
  const text = fs.readFileSync(logPath, 'utf8');
  const m = text.match(/https?:\/\/[^\s"']*\?token=[A-Za-z0-9_\-\.]+/);
  if (!m) throw new Error('在 ' + logPath + ' 里找不到带 token 的 URL（正则 https?://[^\\s"\']*\\?token=...）');
  return { url: m[0], text };
}

/** 目标 URL：默认用日志里那条；给了 --base 就换成 base（token 照带），用于故障注入。 */
function targetUrl(opts, tokenUrl) {
  if (opts.base === DEFAULT_BASE) return tokenUrl;
  const token = (tokenUrl.match(/\?token=([A-Za-z0-9_\-\.]+)/) || [])[1];
  return token ? opts.base.replace(/\/$/, '') + '/?token=' + token : opts.base;
}

/** 喂给 ego-browser nodejs 的脚本。只用 console.log 输出（这个模式没有 cliLog）。 */
function buildPayload(url, shotPath) {
  return `const TARGET_URL = ${JSON.stringify(url)};
const SHOT = ${JSON.stringify(shotPath)};
const PANEL_TEXTS = ${JSON.stringify(PANEL_TEXTS)};
const STABLE_CHARS = 3000;
const norm = (s) => String(s).replace(/\\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
const checks = [];
const check = (id, name, ok, detail) => checks.push({ id: id, name: name, ok: !!ok, detail: String(detail === undefined ? '' : detail).slice(0, 300) });
const errors = [];
let opened = null;
let shot = null;
let shotChat = null;

async function drainConsoleErrors() {
  const evs = await page.drainEvents();
  for (const e of evs) {
    if (e.method === 'Runtime.consoleAPICalled' && e.params && e.params.type === 'error') {
      errors.push('console.error: ' + (e.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 300));
    }
    if (e.method === 'Runtime.exceptionThrown') {
      const d = e.params && e.params.exceptionDetails;
      errors.push('pageerror: ' + String((d && (d.exception && d.exception.description)) || (d && d.text) || ''));
    }
  }
}

async function pageText() {
  return page.evaluate(() => {
    const parts = [document.body.innerText || ''];
    for (const el of document.querySelectorAll('[placeholder]')) parts.push(el.getAttribute('placeholder'));
    for (const el of document.querySelectorAll('[aria-label]')) parts.push(el.getAttribute('aria-label'));
    for (const el of document.querySelectorAll('[title]')) parts.push(el.getAttribute('title'));
    return parts.join('\\n');
  });
}

/** tab 是否处于选中态（aria-selected 或 active/selected class）。 */
async function tabSelected(tab) {
  try {
    if ((await tab.getAttribute('aria-selected')) === 'true') return true;
    return /active|selected/i.test((await tab.getAttribute('class')) || '');
  } catch { return false; }
}

try {
  opened = await browser.openOrReuseTab(TARGET_URL);
  // 先有活动 tab 才能挂 CDP；挂上后 reload 一次，把「加载期」的控制台地雷也收进来。
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await page.drainEvents();
  await page.reload();
  await page.waitForSelector('[class*="frame"]', { timeout: 30000 });
  await page.waitForLoadState('load');

  // 断言 1：加载成功——等「主体内容稳定渲染」的标记，不能只看字符数（侧栏先到约 1.2K，会话区/群聊晚到约 9.7K）
  let stable = false;
  let chars = 0;
  for (let i = 0; i < 60; i++) {   // 上限 30s，每 500ms 探一次
    chars = await page.evaluate(() => (document.body.innerText || '').length);
    if (chars > STABLE_CHARS) { stable = true; break; }
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(500);
  const title = await page.title();
  const url = await page.url();
  const loaded = await pageText();
  check(1, '标题含 DeepSeek Harness', title.includes('DeepSeek Harness'), title);
  check(1, '框架元素已渲染', true, 'selector [class*="frame"]');
  check(1, '主体内容已稳定渲染（>' + STABLE_CHARS + ' 字符）', stable, 'chars=' + loaded.length + ' 探测值=' + chars + ' url=' + url);

  // 断言 2：侧栏「群聊」tab；点开后要**真的切过去**且投影有内容（轮询，上限 10s）
  const chatTab = page.getByRole('tab', { name: '群聊' });
  const hasTab = (await chatTab.count()) > 0;
  check(2, '侧栏出现「群聊」tab', hasTab);
  let switched = false;
  let chatText = '';
  if (hasTab) {
    await chatTab.first().click();
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500);
      switched = switched || (await tabSelected(chatTab.first()));
      chatText = await pageText();
      if (switched && /成员\\s*\\d+/.test(chatText) && /消息\\s*\\d+/.test(chatText)) break;
    }
  }
  check(2, '点开群聊后视图已切换（选中态）', switched);
  check(2, '群聊视图有内容（成员 / 消息计数）', /成员\\s*\\d+/.test(chatText) && /消息\\s*\\d+/.test(chatText), chatText.slice(0, 120).replace(/\\n/g, ' / '));

  // 断言 7：消息流的排序控件（↑ 正序 / ↓ 倒序，默认倒序，选择记在本机）
  const ascBtn = page.getByRole('button', { name: '↑ 正序' });
  const descBtn = page.getByRole('button', { name: '↓ 倒序' });
  const hasOrder = (await ascBtn.count()) > 0 && (await descBtn.count()) > 0;
  check(7, '消息流有 ↑ 正序 / ↓ 倒序 控件', hasOrder);
// 直接读 DOM 的渲染顺序：标题行（文字以「消息流」开头）的下一个兄弟就是消息列表。
// 函数体在页面里执行，拿不到外层的常量，所以键名与正则都写成字面量。
  const readStream = () => page.evaluate(() => {
    const bar = [...document.querySelectorAll('div')].find((d) => (d.textContent || '').trim().startsWith('消息流'));
    const list = bar ? bar.nextElementSibling : null;
    if (!list) return { n: -1, first: null, last: null };
    const rows = [...list.children];
    const stamp = (el) => {
      const m = (el.textContent || '').match(/\\d{2}:\\d{2}:\\d{2}/);
      return m ? m[0] : null;
    };
    return { n: rows.length, first: stamp(rows[0]), last: stamp(rows[rows.length - 1]) };
  });
  const readStored = () => page.evaluate(() => {
    try { return localStorage.getItem('dsh-agent-team-roles:chat-order'); } catch { return null; }
  });
  if (hasOrder) {
    const before = await readStream();    const descDefault = (await descBtn.first().getAttribute('aria-pressed')) === 'true';
    check(7, '默认倒序（↓ 倒序 处于选中态）', descDefault, 'aria-pressed=' + descDefault);
    check(7, '默认倒序：列表首条不早于末条', before.n >= 0 && (before.n < 2 || String(before.first) >= String(before.last)), 'n=' + before.n + ' first=' + before.first + ' last=' + before.last);
    await ascBtn.first().click();
    await page.waitForTimeout(400);
    const after = await readStream();
    const ascPressed = (await ascBtn.first().getAttribute('aria-pressed')) === 'true';
    check(7, '点 ↑ 正序 后改成正序（首条不晚于末条）', ascPressed && after.n >= 0 && (after.n < 2 || String(after.first) <= String(after.last)), 'n=' + after.n + ' first=' + after.first + ' last=' + after.last);
    check(7, '排序只改顺序：消息条数不变', before.n === after.n && before.n >= 0, before.n + ' -> ' + after.n);
    check(7, '选择已记在本机（localStorage=asc）', (await readStored()) === 'asc');
    await descBtn.first().click();
    await page.waitForTimeout(400);
    const back = await readStream();
    check(7, '切回 ↓ 倒序 生效并记住', (await readStored()) === 'desc' && back.n >= 0 && (back.n < 2 || String(back.first) >= String(back.last)), 'n=' + back.n + ' first=' + back.first + ' last=' + back.last);
  }
  // 群聊视图单独留一张证据图（标题层级 / 排序控件都在这张里看）。
  shotChat = await page.screenshot({ path: SHOT.replace(/\\.png$/, '-chat.png') });

  // 断言 3：设置 → Agent Team 角色 → 进面板
  const settingsBtn = page.getByRole('button', { name: '设置' });
  check(3, '侧栏「设置」按钮存在', (await settingsBtn.count()) > 0);
  await settingsBtn.first().click();
  const navBtn = page.getByRole('button', { name: 'Agent Team 角色' });
  await navBtn.first().waitFor({ state: 'visible', timeout: 15000 });
  check(3, '设置里出现「Agent Team 角色」导航项', true);
  await navBtn.first().click();
  let panel = '';
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    panel = await pageText();
    if (panel.includes('启用智能体团队')) break;
  }
  check(3, '能点进角色面板', panel.includes('启用智能体团队'));

  // 断言 4：面板文案逐条出现
  const np = norm(panel);
  for (const t of PANEL_TEXTS) check(4, '面板文案「' + t + '」', np.includes(norm(t)));

  // 断言 5：反证——不得停在「正在读取角色」
  check(5, '未出现「正在读取角色」（没卡加载）', !panel.includes('正在读取角色'));

  // 断言 6：控制台地雷
  await drainConsoleErrors();
  check(6, '无控制台 error / pageerror', errors.length === 0, errors.join(' | '));

  shot = await page.screenshot({ path: SHOT });
} catch (err) {
  check(0, '脚本自身异常', false, String((err && err.message) || err));
  errors.push('fatal: ' + String((err && err.stack) || err).slice(0, 500));
  try { shot = await page.screenshot({ path: SHOT }); } catch (e2) { errors.push('screenshot failed: ' + String(e2 && e2.message)); }
} finally {
  if (opened) { try { await browser.closeTab(opened.targetId); } catch (e3) { errors.push('closeTab failed: ' + String(e3 && e3.message)); } }
}
console.log('ACCEPT_LIVE_RESULT ' + JSON.stringify({ ok: checks.every((c) => c.ok) && errors.length === 0, checks: checks, errors: errors, shot: SHOT, shotChat: shotChat, url: TARGET_URL }));
`;
}

/** 跑驱动：stdin 用「文件句柄」而不是管道（沙箱里管道会 EPERM），输出落日志文件。 */
function runDriver(payload, logPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'accept-live-'));
  const payloadPath = path.join(tmp, 'payload.mjs');
  const outPath = path.join(tmp, 'driver.out.txt');
  fs.writeFileSync(payloadPath, payload);
  const inFd = fs.openSync(payloadPath, 'r');
  const outFd = fs.openSync(outPath, 'w');
  const env = { ...process.env };
  const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!env.EGO_LINUX_CHROME && chrome) env.EGO_LINUX_CHROME = chrome;
  if (!fs.existsSync(DRIVER)) throw new Error('找不到 ego-browser 驱动：' + DRIVER);
  const child = spawn(process.execPath, [DRIVER, 'nodejs'], { stdio: [inFd, outFd, outFd], windowsHide: true, env });
  const kill = () => { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已经退出 */ } };
  const dropTmp = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录删不掉不影响结论 */ } };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { kill(); dropTmp(); reject(new Error('ego-browser 驱动超时（' + DRIVER_TIMEOUT_MS + 'ms）')); }, DRIVER_TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); dropTmp(); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = fs.readFileSync(outPath, 'utf8');
      fs.appendFileSync(logPath, text);
      dropTmp();
      const results = text.split(/\\r?\\n/).filter((l) => l.startsWith('ACCEPT_LIVE_RESULT '));
      if (!results.length) { reject(new Error('驱动没有产出结果行（exit=' + code + '）；原始输出见 ' + logPath)); return; }
      resolve(JSON.parse(results[results.length - 1].slice('ACCEPT_LIVE_RESULT '.length)));
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log('用法：node tools/accept-live.mjs [--log <dsh.log>] [--base <url>] [--shot <name>]'); return 0; }
  const tokenUrl = readTokenUrl(opts.log);
  const url = targetUrl(opts, tokenUrl.url);
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, 'accept-live.log');
  fs.appendFileSync(logPath, '== ' + new Date().toISOString() + ' target=' + url + '\n');
  console.log('target : ' + url);
  console.log('log    : ' + logPath);
  const result = await runDriver(buildPayload(url, path.join(TEST_DIR, opts.shot)), logPath);
  let failed = 0;
  for (const c of result.checks) {
    if (!c.ok) failed++;
    console.log((c.ok ? 'PASS' : 'FAIL') + ' [' + c.id + '] ' + c.name + (c.detail ? ' :: ' + c.detail : ''));
  }
  for (const e of result.errors) { failed++; console.log('FAIL [console] ' + e); }
  console.log('screenshot: ' + result.shot);
  if (result.shotChat) console.log('screenshot: ' + result.shotChat);
  console.log('log       : ' + logPath);
  console.log(failed ? 'RESULT: FAIL (' + failed + ')' : 'RESULT: PASS (' + result.checks.length + ' checks)');
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('accept-live 失败：' + String((err && err.message) || err));
  process.exit(2);
});
