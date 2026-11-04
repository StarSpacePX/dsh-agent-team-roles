// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 群聊页签的空态：这个窗口里没有群聊记录（可能只是没往前翻到）。

import { h } from './../react.js';
import { chatStyles, styles } from './../styles.js';

// 窗口被截断时的空页签不能声称这个会话从没有过团队：要说清记录在哪，并提供往前翻。
// 入参：truncated（窗口被截断）、scan（往前翻的记账）、runScan（再翻 N 段）。
function TeamChatEmpty({ p }) {
  const { truncated, scan, runScan } = p;
  return h(
    'div',
    { style: chatStyles.root },
    h(
      'div',
      { style: chatStyles.empty },
      h('div', null, truncated ? '这个窗口里没有群聊记录。' : '本会话还没有群聊记录。'),
      truncated
        ? h(
            'div',
            { style: { marginTop: 8, opacity: 0.85 } },
            '「群聊」读的是客户端已经缓存的这一段会话日志（约最近一千条），不是整份日志——' +
              '团队活动发生在更早的时候，就不在这段窗口里。' +
              (scan.rounds > 0 ? `已经往前翻了 ${scan.rounds} 段，还没翻到。` : ''),
          )
        : null,
      // §5.48 — 往前翻失败不能静默：给一行可见提示，用户才知道是「读失败」而不是「翻到底了」。
      scan.error
        ? h(
            'div',
            { style: { marginTop: 8, ...chatStyles.note, ...chatStyles.failed } },
            '往前翻失败，请稍后再试。',
          )
        : null,
      truncated
        ? h(
            'div',
            { style: { marginTop: 8, opacity: 0.85 } },
            '新的团队消息（成员创建、@ 收发）会实时出现在这里；要找回更早的，就往前翻日志。',
          )
        : h(
            'div',
            { style: { marginTop: 8, opacity: 0.85 } },
            '群聊消息来自 dsh 自带的「智能体团队」运行时——它随 dsh 安装提供。' +
              '如果它还没开，去「设置 → 插件」里打开「智能体团队」（等价命令：' +
              'dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-profile），' +
              '重启 dsh 后让 Lead 用 spawn_teammate 创建成员并互发消息。',
          ),
      truncated
        ? h(
            'div',
            { style: { marginTop: 10 } },
            h(
              'button',
              {
                type: 'button',
                style: styles.button,
                disabled: scan.running,
                onClick: () => runScan(8),
              },
              scan.running ? '往前翻…' : '往前翻日志找找（再翻 8 段）',
            ),
          )
        : h(
            'div',
            { style: { marginTop: 8, opacity: 0.85 } },
            '开启后这个 tab 会按会话日志顺序显示每个成员的收发消息（含送达状态与时间戳）。',
          ),
    ),
  );
}

export { TeamChatEmpty };
