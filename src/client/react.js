// dsh-agent-team-roles 客户端源码（真源码；`lib/client.js` 是 `node tools/build-client.mjs` 的产物，勿手改）。
// React 与 h：整个客户端只在这里 require 一次 react。


const React = require('react');

const h = React.createElement;

export { React, h };
