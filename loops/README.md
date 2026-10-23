# Loops

定时扫描循环跑在 systemd user timer 上，事件驱动的会话跑在常驻 service 上：环境存活才运行、关机即停，停机窗口的增量由水位在下轮一次补扫。

两件套：`intake`（30min 定时扫描 GitHub 两源与 Slack，只读 + 推候选）和 `relay`（常驻守护，三个平台的消息线程各起一条 pi 会话，不等 timer）。

## 结构

```
loops/
├── intake/                  定时型
│   ├── intake.sh            flock + cd ~/code + pi --mode json --print
│   ├── prompts/scan.md      每轮固定 prompt
│   └── systemd/intake.{service,timer}
└── relay/                   常驻型（三平台共用一个核）
    ├── relay.mjs            唯一入口：relay.mjs <feishu|slack|telegram> | notify <platform> <text>
    ├── core.mjs             会话生命周期：白名单、去重、队列、worker、超时、分块、状态、日志
    ├── chunk.mjs            分块纯函数
    ├── platform.mjs         适配器契约（见 core 的 adapter 形状）
    ├── adapters/<platform>.mjs
    ├── prompts/thread.md    会话首轮模板（占位符由 core 渲染）
    ├── migrate-state.mjs    旧 looper 状态 → relay-<platform>.json
    ├── systemd/relay@.service
    └── *.test.mjs           与源码同目录的用例（`node --test`）
```

一个平台一个进程：`relay@feishu` / `relay@slack` / `relay@telegram`，由同一个 systemd 模板实例化。核里没有平台字面量，平台差异只在 `adapters/<platform>.mjs`。

## 安装

```bash
# 定时型
ln -sf "$(pwd)/loops/intake/systemd/intake.service" ~/.config/systemd/user/
ln -sf "$(pwd)/loops/intake/systemd/intake.timer"   ~/.config/systemd/user/
systemctl --user enable --now intake.timer

# 常驻型（模板 unit，一次链接，按实例启用）
ln -sf "$(pwd)/loops/relay/systemd/relay@.service" ~/.config/systemd/user/
systemctl --user daemon-reload
for p in feishu slack telegram; do systemctl --user enable --now "relay@$p.service"; done
systemctl --user show -p ExecStart relay@feishu.service
```

`ExecStart` 必须解析成 `%h/.bun/bin/bun %h/code/agents-config/loops/relay/relay.mjs %i`。调试时在 worktree 里手动 `bun loops/relay/relay.mjs <platform>`，合并回 master 再启用 unit。

## 状态、凭据、日志

- 状态：`~/.config/taskradar/relay-<platform>.json`，结构 `{ cursor, seen, convs, alerts, meta }`。写入一律经由 core 的 `writeJsonAtomic`（tmp + rename）；禁止整份覆盖写。
- intake 的状态是独立的 `~/.config/taskradar/state.json`（四游标），常驻桥不碰它。
- 凭据（0600，不入库）：`feishu.env`（`FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_CHAT_ID`）、`slack-app.env`（`SLACK_APP_TOKEN`）、`webhook.url`（Slack 回帖，app 身份）、`.slack-xoxc.tmp`（读 Slack thread root）、`telegram.env`（`TELEGRAM_BOT_TOKEN` / `TELEGRAM_ALLOWED_USER` / `TELEGRAM_CHANNEL_ID` / `TELEGRAM_CHAT_ID`）。
- 环境变量统一 `RELAY_` 前缀：`RELAY_ALLOWED_USER`、`RELAY_WORKER`（默认 `pi`，`stub` 只回显）、`RELAY_TIMEOUT_MS`、`RELAY_MAX_WORKERS`、`RELAY_QUEUE_DEPTH`。
- 日志：`~/.config/taskradar/logs/{intake,feishu,slack,telegram}/`，保留 72h（intake 每轮自清，relay 启动时与每 24h 清）。仓内禁止出现 `loops/*/logs/`。

## 平台差异（由适配器承担）

| 平台 | 会话 key | 入口 | 「处理中」信号 | 回帖上限 |
|---|---|---|---|---|
| feishu | `th-<thread/root/parent>`、无话题 `ms-<msg>`，session `fs-<key>` | 群内话题或新消息 | `THINKING` reaction（无权限时占位卡原地 PATCH） | 卡片 3000 |
| slack | thread ts 去点，session `slack-<ts>` | `#agent-intake` 任意消息 | 无 | 3500 |
| telegram | `ch<帖id>`，session `tg-ch<id>` | 频道 Post，讨论组评论归位 | `sendChatAction(typing)` 4s | 4096 |

Slack 判活只认协议级 ping/pong：30s 无 server ping 或 10s 无 pong 即 `terminate` 重连，换连按 `approximate_connection_time × 0.8` overlap。飞书长连接是集群模式，**同一应用全局只允许一个消费者**。

## 测试

```bash
node --test loops/relay/*.test.mjs loops/relay/adapters/*.test.mjs   # 与 `npm test`（node --test）一致
```

用例必须零网络、零真实状态写入（临时目录），平台 SDK 只在装配层 import；行为变更与用例同 PR。

## 新增一个平台

1. 写 `loops/relay/adapters/<platform>.mjs`：`createAdapter({ paths, readEnv, log })` 返回 `{ name, allowedUser, chunkLimit, timeoutMs, maxWorkers, queueDepth, worker, piBin, replyRules, start({ onMessage, core }), reply, notify?, onProgress?, onProgressDone? }`
   - `notify` 是可选能力，但**必须在 `start()` 之前可调用**：`relay.mjs notify <platform> <text>` 只加载适配器、不调 `start()`，intake 定时轮依赖这条路径。
   - 平台 SDK（client）一律懒建并经依赖注入（`createClient` / `loadSdk`），不得在模块作用域构造，否则单文件的 `notify` 会把整个常驻桥的初始化拖进来。
2. `start` 只做「事件源 → `onMessage(inbound)`」，`inbound` 带 `{ key, session, dedupeId, authorId, text, chatId, rootText, replyTo }`；不要自己写 `state.seen`（去重归 core）
3. 会判定的逻辑（健康检查、映射、游标）抽成纯函数导出，并补用例
4. `relay.mjs` 的 `PLATFORMS` 加一项，`systemctl --user enable --now relay@<platform>`

## 水位规则

- 外置 state 是唯一跨轮状态；写入用 core 的原子写，禁止把整份快照盖回去
- state 只放增量游标与已知集合，不放候选台账——候选的上下文是频道消息与 thread
- 失败轮/超时轮不推进水位（下轮重扫同一窗口），但异常要写进当日 daily log
- 水位只增不减；源头重构（换频道/换列）时人工重置
