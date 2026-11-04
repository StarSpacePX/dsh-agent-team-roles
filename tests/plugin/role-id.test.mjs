/** 角色 ID 编辑（「新建角色」那一行 / 详情面板改 id）。
 * 两条都是「用户打的裸名字 → 完整角色 id」的客户端形状断言，单独成文件。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// 角色 id 就是成员名加 team- 前缀。「新建角色」那一行有 id 输入框，敲下去就先显示最终 id 与成员名。

test('the create-role row takes an explicit English id', async () => {
  const source = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
  assert.match(source, /const \[newId, setNewId\] = React\.useState\(''\)/)
  assert.match(source, /function roleIdFromInput\(value, prefix\)/)
// 只留 id 允许的字符；带不带前缀都认，返回的一定是完整 id。
  assert.match(source, /\.replace\(\/\[\^a-z0-9-\]\+\/g, '-'\)/)
  assert.match(source, /return clean\.startsWith\(tag\) \? clean : `\$\{tag\}\$\{clean\}`/)
// 两个框的说明压到最短：「中文名，如：架构师」/「英文名，如：dev」。
  assert.match(source, /placeholder: '英文名，如：dev'/)
  assert.match(source, /placeholder: '中文名，如：架构师'/)
// 留空 = 老行为（宿主按名字 slug）；填了就显式传 id。
  assert.match(source, /const draftRoleId = roleIdFromInput\(newId, newRoleIdPrefix\)/)
  assert.match(source, /\.\.\.\(draftRoleId === '' \? null : \{ id: draftRoleId \}\)/)
// 敲下去就能看见成员名，非法输入不会被发出去。
  assert.match(source, /成员名：\$\{draftMemberName\}（spawn_teammate 用这个名字）/)
  assert.match(source, /角色 ID 只能用英文小写字母、数字和短横线/)
  assert.match(source, /newId\.trim\(\)\.length > 0 && draftRoleId === ''/)
})

// ---- 详情面板改角色 ID ----
// 客户端只负责把裸名字补成完整 id、把三种坏情况说清楚、把改动交给 update-role 的 newId；
// 目录 / 文件 / preset 怎么一起换是宿主的事。

test('the detail panel edits the role id under the name field', async () => {
  const source = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')

// 草稿 + 同步：选中谁就填谁（界面上只写去掉前缀的成员名）。
  assert.match(source, /const \[idDraft, setIdDraft\] = React\.useState\(''\)/)
  assert.match(source, /setIdDraft\(selected\.id\.startsWith\(prefix\) \? selected\.id\.slice\(prefix\.length\) : selected\.id\)/)
// 三种状态：非法 / 被占用 / 改过了 —— 提示行按这个优先级落到 error 或 hint。
  assert.match(source, /const selectedIdDraft = roleIdFromInput\(idDraft, newRoleIdPrefix\)/)
  assert.match(source, /const idDraftInvalid = idDraft\.trim\(\)\.length > 0 && selectedIdDraft === ''/)
  assert.match(source, /const idDraftTaken =/)
  assert.match(source, /state\.roles\.some\(\(role\) => role\.id === selectedIdDraft\)/)
  assert.match(source, /const idDraftChanged = selected !== null && selectedIdDraft !== selected\.id/)

  // 输入框就在「名字」下面一行，label 写明它同时是成员名。
  const nameIndex = source.indexOf("'名字'")
  const idIndex = source.indexOf("'角色 ID（成员名）'")
  assert.ok(nameIndex > 0 && idIndex > nameIndex, '「角色 ID（成员名）」要在「名字」之后')
  assert.match(source, /placeholder: '英文，例如 devtest'/)
  assert.match(source, /onChange: \(event\) => setIdDraft\(event\.target\.value\)/)

  // 提示四态：非法 / 占用 / 保存后 / 现状。
  assert.match(source, /已经有角色在用这个 ID：\$\{selectedIdDraft\}/)
  assert.match(source, /保存后：角色 ID \$\{selectedIdDraft\} · 成员名 \$\{selectedMemberName\}/)
  // 已经建好的成员不会跟着改名 —— 这句必须留着，否则用户以为改 id 能救回旧成员。
  // 用户 ：常态那行「成员名：…」搬进标题旁边的 ⓘ（键 `roleMemberName`），
  // 框下面只留「非法 / 被占用 / 保存后」三种要当场看见的状态。
  assert.match(source, /已经建好的成员不会跟着改名/)
  assert.match(source, /info\(\s*'roleMemberName',\s*'成员名：\{member\}（spawn_teammate 用这个名字）/)
  assert.doesNotMatch(source, /: `成员名：\$\{selectedMemberName\}（spawn_teammate 用这个名字）`/)

  // 坏 id 不能点保存；改了才发 newId，并且要把选中项切到新 id 上。
  assert.match(source, /disabled: busy \|\| idDraftInvalid \|\| idDraftTaken/)
  assert.match(source, /\.\.\.\(idDraftChanged \? \{ newId: selectedIdDraft \} : null\)/)
  assert.match(source, /if \(payload && payload\.id\) setSelectedId\(payload\.id\)/)

  // §B3 —— 换角色要**一次提交**（用户 ：「切换过程中会出现一闪而过的一行红字…
  // 整个页面的文字被挤开了」）。只 `setSelectedId` 的话，填表要等跑在绘制之后的 effect，
  // 中间那一帧表单里还是上一个角色的值 → `idDraftTaken` 为真 → 红字闪一下。
  assert.match(source, /const selectRole = \(roleId\) => \{/)
  assert.match(source, /onClick: \(\) => \{[\s\S]{0,260}selectRole\(role\.id\)/)
  assert.doesNotMatch(source, /setSelectedId\(role\.id\)/, '换角色不许只换选中项（会闪一帧）')
  assert.match(
    source,
    /const selectRole = \(roleId\) => \{[\s\S]{0,900}setDirty\(null\)[\s\S]{0,200}setSelectedId\(roleId\)[\s\S]{0,600}setIdDraft\(nakedMemberName\(next\.id, prefix\)\)/,
  )

  // 用户 ：角色行副标题只留「英文名(中文名)」—— team- 前缀和模式标签不再挤这一行。
  assert.match(source, /const memberName = nakedMemberName\(role\.id, newRoleIdPrefix\)/)
  assert.match(source, /role\.name !== memberName[\s\S]{0,120}\? `\$\{memberName\}\(\$\{role\.name\}\)`/)
  assert.doesNotMatch(source, /role\.modeLabel \? `\$\{role\.id\} · \$\{role\.modeLabel\}`/)
  // 用户 ：「不要搞两行，只要一行」—— 角色行只有这一串文本，没有第二个 div。
  assert.match(source, /\},\n\s+roleLabel,/)
  assert.doesNotMatch(source, /styles\.id, opacity/)
})

//#endregion

//#region — `tools.restrict()` 的运行时调用（此前零覆盖）
// `fakeTools()` 过去只实现 `schemas()`，于是每个走网关分支的用例都停在
// `typeof tools.restrict !== 'function'` 那道守卫上（`lib/host/gate.js:46`、
// `:118`），网关真正调 `restrict()` 隐藏工具的那几行从来没被执行过。
// 下面两条用例让假 registry 也实现 `restrict()`，并断言 deny 名单真的传了进去。
