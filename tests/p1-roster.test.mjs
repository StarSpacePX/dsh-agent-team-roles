/**
 * §5.43 — 名册文本（`D5` 组）。
 *
 * 从 `p1-host.test.mjs` 切出来：这组只测"那段文字长什么样"（谁在、名字全不全、
 * 介绍说几遍、vacant 行、loop/继承是不是现推），和宿主接线（D1–D4）不是一回事。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { rosterText } from '../lib/team-roster.js'

/**
 * D5 — 名册是**运行期快照**：文本一变，整段 runtime context 就再物化一次，
 * 顺带打断一次 prompt cache（`lib/team-roster.js:11-15`）。所以只做三类事：
 * 削掉永远不变的多余字符、按集合排序（别让返回顺序决定文本）、把尾巴折叠。
 */
const member = (name, status = 'active', extra = {}) => ({ role: 'teammate', name, status, ...extra })

test('D5: 名册行砍掉 spawn 时的自由文本 description，name / status / model 保留', () => {
  const text = rosterText(
    [member('alpha', 'active', { model: 'sonnet', description: 'PROBE-D5-这段描述不该出现在 prompt 里' })],
    [],
    'team-',
  )
  assert.ok(!text.includes('PROBE-D5'), 'description 是每次拼装原样重复的自由文本，不该进名册')
  assert.match(text, /- alpha（active，sonnet）/)
})

test('D5: 服务返回成员的顺序不影响名册文本（按名字排序）', () => {
  const rows = [member('bob'), member('alice'), member('carol')]
  const forward = rosterText(rows, [], 'team-')
  const backward = rosterText(rows.slice().reverse(), [], 'team-')
  assert.equal(forward, backward, '顺序一变就重发整段 context，等于凭空烧 token')
  assert.ok(forward.indexOf('alice') < forward.indexOf('bob'))
  assert.ok(forward.indexOf('bob') < forward.indexOf('carol'))
})

test('D5: 已完成的成员照样逐行列出，名字一个不少', () => {
  const text = rosterText(
    [member('alice'), member('done-one', 'inactive'), member('done-two', 'inactive')],
    [],
    'team-',
  )
  assert.ok(text.includes('- alice（active）'), '活跃成员照旧')
  assert.ok(text.includes('- done-one（inactive）'), '已完成成员也带名字（用户 m17074：名册必须有最新成员名称）')
  assert.ok(text.includes('- done-two（inactive）'))
  assert.ok(!text.includes('已完成'), '不再拿计数顶替名字')
})

test('D5: 成员一个都不截断，名字全在', () => {
  const rows = Array.from({ length: 12 }, (_, index) => member(`m${String(index).padStart(2, '0')}`))
  const text = rosterText(rows, [], 'team-')
  const rowsInText = text.split('\n').filter((line) => /^- m\d\d（/.test(line))
  assert.equal(rowsInText.length, 12, '成员名称必须全在（用户 m17074）')
  assert.ok(text.includes('- m11（active）'))
  assert.ok(!text.includes('未列出'))
})

test('D5: 成员行只有名字/状态/模型，介绍只在角色块里说一次', () => {
  const about = '收集总结搜索网页/源码/文档/项目现状等工作'
  const text = rosterText(
    [member('select', 'active', { model: 'sonnet' })],
    [{ id: 'team-select', name: '探查员', description: about }],
    'team-',
  )
  assert.match(text, /- select（active，sonnet）\n/, '成员行不再背介绍（用户 m17255：成员就是角色，介绍写一次就够）')
  assert.ok(!text.includes('select（active，sonnet） 探查员'), '同一句介绍不再出现两遍')
  assert.ok(
    text.includes(`- 「探查员」 → name 用 "select"；${about}；loop: standard，不继承上下文`),
    '角色行 = 描述 + loop 名 + 是否继承上下文（用户 m17599）',
  )
})

test('D5: 角色行里的 loop 与继承上下文是从角色设置现推的，不用人写进描述', () => {
  const role = (extra) => ({ id: 'team-devtest', name: '开发测试', description: '全链路开发测试', ...extra })
  const inherit = rosterText([], [role({ mode: 'user', overrides: { 'tool-subagent': { disabled: false, config: { provider: 'fork' } } } })], 'team-')
  assert.match(inherit, /全链路开发测试；loop: user，继承上下文/, 'loop 取角色自己的 mode（用户 m17599）')

  const fresh = rosterText([], [role({ mode: 'user', overrides: { 'tool-subagent': { disabled: false } } })], 'team-')
  assert.match(fresh, /loop: user，不继承上下文/, '没有 provider: fork 就是不继承')

  const off = rosterText([], [role({ overrides: { 'tool-subagent': { disabled: true, config: { provider: 'fork' } } } })], 'team-')
  assert.match(off, /loop: standard，不继承上下文/, '关掉 tool-subagent 的行不继承；没设 mode 就是默认模式')
})

test('D5: 一个成员都没有时，名册里每个角色各占一行、状态是 vacant', () => {
  const text = rosterText([], [{ id: 'team-select', name: '探查员', description: '探查' }], 'team-')
  assert.match(text, /你是本会话的 Team Lead/)
  assert.match(text, /<team-roster>\n- select（vacant）\n<\/team-roster>/, '标签里只有行，没建的也占一行（用户 m17306/m17317）')
  assert.match(text, /<team-roles>/)
})

