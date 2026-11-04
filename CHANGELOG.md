# 变更记录

本文件记录本插件所有值得注意的变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.0] - 2026-11-04

### 新增

- 角色即 preset：每个角色注册成一枚独立 agent preset，与内置的 `standard` / `cordis` / `ptc` / `minimal`
  并列出现在 preset 选择器里。
- 会话页签栏两个页面：「角色」配置页与「群聊」页。
- 角色配置面板：过滤、只看被改过的行、整类三态开关、分类折叠，一次手势合并成一条批量请求。
- 能力行开关：工具 / 技能 / MCP / 分组 / AGENTS.md，只改已有行，不凭空造行。
- 成员绑定：`set-team` 打开团队运行时，`bindMembers` 把新建成员绑到同名角色。
- 群聊页签：宿主侧把 Lead 会话日志里的 `team/*` 事件折叠成三张表，只读投影，不依赖任何外部数据库。
- 数据自持：所有数据写在 `<DSH_HOME>/agent-team-roles/`，不碰 shipped preset、不碰 `settings.yaml`、不碰 dsh 包本身。

### 说明

- 首个开源版本。此前的内部迭代按 §5.x 编号记录在本机文档里，未随本仓发布。
