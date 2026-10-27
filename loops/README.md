# Loops

两个定时循环跑在 systemd user timer 上；常驻的 IM 桥已独立成仓
[`35iter-cn/agent-relay`](https://github.com/35iter-cn/agent-relay)（本地 `~/code/agent-relay`），
本仓只保留它的调用方。

## 结构

```
loops/
├── intake/                  定时型：扫 GitHub 两源与 Slack，只读 + 推候选
│   ├── intake.sh            flock + cd ~/code + pi --mode json --print
│   ├── prompts/scan.md      每轮固定 prompt
│   └── systemd/intake.{service,timer}
└── agent-hours/             定时型：读 Pi 插件写的账本，按 session 判 count/skip，写 Clock 并推送
    ├── hours.mjs
    └── systemd/agent-hours.{service,timer}
```

## 与 agent-relay 的接口

- **候选播报**：intake 在 `prompts/scan.md` 里调
  `agent-relay notice emit --platform feishu --text "<payload>" --prompt-file ~/.config/agent-relay/prompts/candidate-rules.md`。
  `--prompt-file` 是用户回复候选通知时注入的会话指令，放在私有配置里，不进任何仓库。
- **工时汇总**：`hours.mjs` 的 `notifyFeishu()` 调同一条 `notice emit`；judge 从
  `~/code/agent-relay/src/judgment/jev.mjs` 动态加载（`AGENT_RELAY_HOME` 可覆盖路径）。
- **状态、凭据、日志**：`~/.config/agent-relay/`（`0700`/`0600`），由 agent-relay 仓管理；
  intake 自己的四游标 `state.json` 仍在 `~/.config/taskradar/`，relay 不碰它。
- **升级**：`scripts/relay-upgrade.sh <platform>` 等 `queued|running|answered` 归零后重启
  `agent-relay@<platform>`，探活要求 MainPID 变化，结束后推一条通知。

## 安装

```bash
# 定时型
ln -sf "$(pwd)/loops/intake/systemd/intake.service" ~/.config/systemd/user/
ln -sf "$(pwd)/loops/intake/systemd/intake.timer"   ~/.config/systemd/user/
ln -sf "$(pwd)/loops/agent-hours/systemd/agent-hours.service" ~/.config/systemd/user/
ln -sf "$(pwd)/loops/agent-hours/systemd/agent-hours.timer"   ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now intake.timer agent-hours.timer
```

## 使用判定（agent-hours）

归属判定只依赖 Jev，不走正则。prompt 分三段：`【话题起始消息】` / `【本轮用户消息】` /
`【agent 本轮回答（仅供参考，不是用户请求）】`（回答截 400 字）。criteria 与 instructions 由
`~/.config/agent-relay/usage-prompt.json` 提供（`{ instructions, criteria }`）；没有这个文件时
usage 记录里的 `magic` 恒为 `unconfigured`，不影响 relay 与工时判定本身。

## 调度与通知（agent-hours）

- 每小时整点跑一轮：判定新单元、按 48 小时窗口对齐 Clock 段。
- 飞书只在 **Clock 真的被改动**时发（本轮新增 / 改 / 删任一段非零）；没改动就静默，只写 digest 与事件流。
- Clock 未启用或同步失败时退回「有新单元就发」，避免整条链路被静默吃掉。
- 没发出去的新单元不会标记为已通知，会攒在下一次真正发通知的那轮里一起汇报。

## 日志

- intake 轮次日志：`~/.config/taskradar/logs/intake/`，每轮自清，保留 72h
- 工时日志：`~/.config/taskradar/logs/hours/`
- relay 的事件/usage 日志：`~/.config/agent-relay/logs/<platform>/<day>.jsonl`，保留 72h

仓内禁止出现 `loops/*/logs/`。

## 测试

```bash
bun loops/agent-hours/hours.test.mjs
```
