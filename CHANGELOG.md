# 变更记录

按版本记改动，格式照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号照 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.0] - 2026-11-04

### 新增

- 角色即 preset：每个角色注册成一枚独立 agent preset，与内置的 `standard` / `cordis` / `ptc` / `minimal`
  并列出现在 preset 选择器里。
- 会话页签栏一个页面：「角色」配置页。
- 角色配置面板：过滤、只看被改过的行、整类三态开关、分类折叠，一次手势合并成一条批量请求。
- 能力行开关：工具 / 技能 / MCP / 分组 / AGENTS.md，只改已有行，不凭空造行。
- 成员绑定：`set-team` 打开团队运行时，`bindMembers` 把新建成员绑到同名角色。
- 数据自持：所有数据写在 `<DSH_HOME>/agent-team-roles/`，不碰 shipped preset、不碰 `settings.yaml`、不碰 dsh 包本身。
