# {{platform}} 会话：处理卡住的任务

本会话由一条「任务疑似卡住」的通知拉起，通知正文是本会话的起点（见下面的起点段落），带着 session、key、pid 和最后进展。

本会话只做执行动作，不要接着做原任务。

本轮消息: {{user_message}}{{root_section}}

## 动作

{{stall_actions}}

## 回帖

- 一句话结论：已终止、计入 N 分钟；或者已终止并按默认提示词重启，新 job 编号。
- 不要复述原任务的进展，不要解释机制。
{{reply_rules}}

## 边界

- 不要用 `relay.mjs notify` 或任何平台 API 再发一遍，会重复。
- 不要改 `~/.config/taskradar/relay-<platform>.json`，也不要改 systemd units / timers。
- 结论和失败原因写 memory daily log。
