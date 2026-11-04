// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 消息流的阅读顺序：默认倒序（最新在上），↑/↓ 切换，选择记在本机。

import { React, h } from './../react.js';
import { chatStyles } from './../styles.js';

const ORDER_KEY = 'dsh-agent-team-roles:chat-order';

function readOrder() {
  try {
    return globalThis.localStorage?.getItem(ORDER_KEY) === 'asc' ? 'asc' : 'desc';
  } catch {
    // 读不到偏好不是错误：退回默认倒序，别的都不受影响。
    return 'desc';
  }
}

function writeOrder(order) {
  try {
    globalThis.localStorage?.setItem(ORDER_KEY, order);
  } catch {
    // 记不住也照样能排序：这一次会话内仍然按用户点的那一侧渲染。
  }
}

function useOrder() {
  const [order, setOrder] = React.useState(readOrder);
  const pick = (next) => {
    writeOrder(next);
    setOrder(next);
  };
  return [order, pick];
}

function orderButton(order, value, label, hint, onPick) {
  return h(
    'button',
    {
      type: 'button',
      style: { ...chatStyles.orderBtn, ...(order === value ? chatStyles.orderOn : {}) },
      title: hint,
      'aria-pressed': order === value,
      onClick: () => onPick(value),
    },
    label,
  );
}

function OrderSwitch(props) {
  return h(
    'div',
    { style: chatStyles.orderGroup },
    orderButton(props.order, 'asc', '↑ 正序', '按时间正序（早 → 晚）', props.onPick),
    orderButton(props.order, 'desc', '↓ 倒序', '按时间倒序（新 → 旧，默认）', props.onPick),
  );
}

export { OrderSwitch, useOrder };
