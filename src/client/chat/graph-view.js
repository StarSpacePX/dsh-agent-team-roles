// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 群聊页签中段：角色依赖图（@ 周期选择 + 一对 mapping 一行 + 可展开的时间线）。

import { React, h } from './../react.js';
import { chatStyles, styles } from './../styles.js';
import { T } from './../tokens.js';
import { blockText, formatClock } from './fold.js';
import { firstLine } from './markdown-style.js';

function TeamChatGraph({ p }) {
  const {
    leadRows,
    cycleStart,
    cycleEnd,
    range,
    setRange,
    selectStyle,
    setFocusKey,
    pairs,
    inverted,
    expanded,
    togglePair,
    graphChipStyle,
    colorOfRow,
    nameById,
    leadIds,
  } = p;
  return h(
    React.Fragment,
    null,
    h('div', { style: chatStyles.sectionBar }, h('span', { style: chatStyles.sectionTitle }, '角色依赖图')),
    leadRows.length > 1
      ? h(
          'div',
          { style: chatStyles.controls },
// 不显示「统计周期」四个字，「到」用一个短横线。
          h(
            'select',
            {
              style: selectStyle('start'),
              value: cycleStart === undefined ? '' : String(cycleStart.message.id),
              onFocus: () => setFocusKey('start'),
              onBlur: () => setFocusKey(null),
              onChange: (event) =>
                setRange({
                  startId: event.target.value,
                  endId: range !== null && range.endId ? range.endId : '',
                }),
            },
            leadRows.map((row, index) =>
              h(
                'option',
                { key: `start:${row.message.id}`, value: String(row.message.id) },
                `第 ${index + 1} 次 @ · ${formatClock(row.time)}`,
              ),
            ),
          ),
          h('span', { style: chatStyles.controlLabel }, '-'),
          h(
            'select',
            {
              style: selectStyle('end'),
              value: range !== null && range.endId ? String(range.endId) : '',
              onFocus: () => setFocusKey('end'),
              onBlur: () => setFocusKey(null),
              onChange: (event) =>
                setRange({
                  startId: cycleStart === undefined ? '' : String(cycleStart.message.id),
                  endId: event.target.value,
                }),
            },
            [h('option', { key: 'end:latest', value: '' }, '最新（含 @ 之后的回复）')].concat(
              leadRows.map((row, index) =>
                h(
                  'option',
                  { key: `end:${row.message.id}`, value: String(row.message.id) },
                  `第 ${index + 1} 次 @ · ${formatClock(row.time)}`,
                ),
              ),
            ),
          ),
          range === null
            ? null
            : h(
                'button',
                { type: 'button', style: styles.button, onClick: () => setRange(null) },
                '恢复默认（第一次 @ → 最新）',
              ),
        )
      : null,
    pairs.length === 0
      ? h(
          'div',
          { style: { fontSize: T.font.xs, opacity: 0.7 } },
          inverted
            ? '起始 @ 晚于结束 @，这个周期是空的——把两个下拉框对调一下。'
            : '这个周期内还没有任何 @。',
        )
      : h(
          'div',
          { style: chatStyles.graph },
          pairs.map((pair) => {
// 一对 mapping 一行：这一对里只要有 Lead，Lead 一律在左，两个数字跟着显示顺序（左数字 = 左→右）；
// 两边都不是 Lead（成员↔成员）时沿用「发起方在左」。
            const leftIsLead = leadIds.has(String(pair.leftId));
            const rightIsLead = leadIds.has(String(pair.rightId));
            const both = pair.out > 0 && pair.back > 0
            // 只要有 Lead 且它在右，就翻过来；两边都不是 Lead 时沿用「发起方在左」。
            const flip = rightIsLead || (!leftIsLead && !both && pair.out === 0);
            const leftId = flip ? pair.rightId : pair.leftId
            const leftName = flip ? pair.rightName : pair.leftName
            const rightId = flip ? pair.leftId : pair.rightId
            const rightName = flip ? pair.leftName : pair.rightName
            const outCount = flip ? pair.back : pair.out
            const backCount = flip ? pair.out : pair.back
            const nameOf = (id) =>
              id === pair.leftId ? pair.leftName : id === pair.rightId ? pair.rightName : nameById.get(id) ?? id
            const title = both
              ? `${leftName} → ${rightName} ${outCount} 条；${rightName} → ${leftName} ${backCount} 条`
              : `${leftName} → ${rightName} ${pair.rows.length} 条`
// 两个方向永远都报数字：单向的那一行写 @0 ⇄ @1，不用 → @n / ← @n 的省略写法。
            const countText = `@${outCount} ⇄ @${backCount}`
            return h(
              'div',
              { key: pair.key },
              h(
                'button',
                {
                  type: 'button',
                  title,
// 常态与悬停都不上底色，只保留描边为零的行式布局。
                  style: chatStyles.graphRow,
                  onClick: () => togglePair(pair.key),
                },
                h('span', { style: graphChipStyle(colorOfRow(leftId, leftName)) }, leftName),
                h('span', { style: chatStyles.count }, countText),
                h('span', { style: graphChipStyle(colorOfRow(rightId, rightName)) }, rightName),
              ),
              expanded.has(pair.key)
                ? h(
                    'div',
                    { style: chatStyles.timeline },
                    pair.rows.map((row) =>
                      h(
                        'div',
                        { key: `${row.seq}:${row.message.id}`, style: chatStyles.tlRow },
                        h('span', { style: chatStyles.tlTime }, formatClock(row.time)),
// 合并后的时间线里可能两个方向都有，用箭头标出这一条是谁 @ 谁。
                        both
                          ? h(
                              'span',
                              {
                                style: { opacity: 0.7, flex: '0 0 auto' },
                                title: `${nameOf(String(row.message.senderId))} → ${nameOf(String(row.message.targetId))}`,
                              },
                              String(row.message.senderId) === leftId ? '→' : '←',
                            )
                          : null,
// 不按字数硬切，取整条消息的第一行，由 CSS 在行尾省略；title 挂全文，悬停仍能看完整内容。
                        h(
                          'span',
                          { style: chatStyles.tlText, title: blockText(row.message.content) },
                          firstLine(row.message.content),
                        ),
                        h(
                          'span',
                          { style: row.delivered === true ? chatStyles.ok : chatStyles.failed },
                          row.delivered === true ? '已送达' : '排队中',
                        ),
                      ),
                    ),
                  )
                : null,
            )
          }),
        ),
  );
}

export { TeamChatGraph };
