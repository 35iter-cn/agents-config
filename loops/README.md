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

`agent-hours/` 是工时链路的判定段（spec 06）：每 30 分钟读一次 Pi 插件写的账本，按 session 划单元、交 Jev 判 `count / skip / review`，有新增就推一条飞书。状态在 `~/.config/agent-hours/`（`decisions.json` 缓存、`review/` 队列、`digest/` 每日一行），Clock 写入尚未接。

一个平台一个进程：`relay@feishu` / `relay@slack` / `relay@telegram`，由同一个 systemd 模板实例化。核里没有平台字面量，平台差异只在 `adapters/<platform>.mjs`。

## 安装

```bash
# 定时型
ln -sf "$(pwd)/loops/intake/systemd/intake.service" ~/.config/systemd/user/
ln -sf "$(pwd)/loops/intake/systemd/intake.timer"   ~/.config/systemd/user/
systemctl --user enable --now intake.timer

# 定时型（工时判定）
ln -sf "$(pwd)/loops/agent-hours/systemd/agent-hours.service" ~/.config/systemd/user/
ln -sf "$(pwd)/loops/agent-hours/systemd/agent-hours.timer"   ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now agent-hours.timer

# 常驻型（模板 unit，一次链接，按实例启用）
ln -sf "$(pwd)/loops/relay/systemd/relay@.service" ~/.config/systemd/user/
systemctl --user daemon-reload
for p in feishu slack telegram; do systemctl --user enable --now "relay@$p.service"; done
systemctl --user show -p ExecStart relay@feishu.service
```

`ExecStart` 必须解析成 `%h/.bun/bin/bun %h/code/agents-config/loops/relay/relay.mjs %i`。调试时在 worktree 里手动 `bun loops/relay/relay.mjs <platform>`，合并回 master 再启用 unit。

## 状态、凭据、日志

- 状态：`~/.config/taskradar/relay-<platform>.json`，结构 `{ cursor, seen, convs, alerts, meta, jobs, inbox }`（`meta.schemaVersion = 2`）。写入一律经由 core 的 `writeJsonAtomic`（tmp + rename）；禁止整份覆盖写。
- intake 的状态是独立的 `~/.config/taskradar/state.json`（四游标），常驻桥不碰它。
- 凭据（0600，不入库）：`feishu.env`（`FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_CHAT_ID`）、`slack-app.env`（`SLACK_APP_TOKEN`）、`webhook.url`（Slack 回帖，app 身份）、`.slack-xoxc.tmp`（读 Slack thread root）、`telegram.env`（`TELEGRAM_BOT_TOKEN` / `TELEGRAM_ALLOWED_USER` / `TELEGRAM_CHANNEL_ID` / `TELEGRAM_CHAT_ID`）。
- 环境变量统一 `RELAY_` 前缀：`RELAY_ALLOWED_USER`、`RELAY_WORKER`（默认 `pi`，`stub` 只回显）、`RELAY_TIMEOUT_MS`、`RELAY_MAX_WORKERS`、`RELAY_QUEUE_DEPTH`。
- 日志：`~/.config/taskradar/logs/{intake,feishu,slack,telegram}/`，保留 72h（intake 每轮自清，relay 启动时与每 24h 清）。仓内禁止出现 `loops/*/logs/`。
- 运行记录：`~/.config/taskradar/logs/usage/<YYYY-MM-DD>.jsonl`，`deliver()` 收尾后一行一次。字段 `ts/jobId/platform/key/session/startedAt/endedAt/durationMs/status/inputChars/answerChars/answerHead/magic/confidence/fallback`。`magic` 四个取值：`magic_work` / `non_magic` / `unknown`（判了但未定，看 `fallback` 的 `low-confidence`/`timeout`/`circuit`/`nokey`）/ `unjudged`（非 `done` 终态，`fallback` 保留 `failed`/`cancelled`/`interrupted`）。
- 归属判定只依赖 Jev，不走正则：state 分三段（`【话题起始消息】` / `【本轮用户消息】` / `【agent 本轮回答（仅供参考，不是用户请求）】`，回答截 400 字），criteria 里带 MagicDoor 资产清单（仓库、口语简称、内部系统、业务对象、明确不属于的四类），instructions 要求用前几轮消息解析「上一轮」「这个模式」这类指代。

## 平台差异（由适配器承担）

| 平台 | 会话 key | 入口 | 「处理中」信号 | 回帖上限 |
|---|---|---|---|---|
| feishu | `th-<thread/root/parent>`、无话题 `ms-<msg>`，session `fs-<key>` | 群内话题或新消息 | `THINKING` reaction（无权限时占位卡原地 PATCH） | 卡片 3000 |
| slack | thread ts 去点，session `slack-<ts>` | `#agent-intake` 任意消息 | 无 | 3500 |
| telegram | `ch<帖id>`，session `tg-ch<id>` | 频道 Post，讨论组评论归位 | `sendChatAction(typing)` 4s | 4096 |

入站文本统一在适配器里剥掉 mention：飞书按 `mentions[].key`（`@_user_N` 占位符）、Slack 按 `<@U…>`、Telegram 按 `entities[]` 的 offset。**Telegram 不能扫描 `@`** —— 正文里的邮箱、链接、账号名会一起被吃掉。因此 `core.mjs` 只接收纯文本，指令判定不做任何平台兜底。代价：正文中被 @ 的人名会消失（群当前是 1:1，无第三人可指；群里出现第三者时需要重新评估）。

飞书另有开机上线通知：每次开机后第一条长连接就绪（`ws-ready`）时向群推一条 `🟢 系统已启动，Agent 已准备好接收你的任务`（复用 `notify`，会 @ Hao）。去重键是 `/proc/sys/kernel/random/boot_id`，记在 `relay-feishu.json` 的 `meta.bootNotice`——同一次开机内崩溃拉起、部署重启都不重复推；发送失败不写该键，下次重启自动重试。

Slack 判活只认协议级 ping/pong：30s 无 server ping 或 10s 无 pong 即 `terminate` 重连，换连按 `approximate_connection_time × 0.8` overlap。飞书长连接是集群模式，**同一应用全局只允许一个消费者**。

## job 与崩溃恢复

每一条入站消息落成一个 job，状态机在 `jobs.mjs`，事实存在 state 文件里：

| 状态 | 含义 | 重启后的动作 |
|---|---|---|
| `queued` | 已受理、未派发 | 自动重跑（无任何副作用） |
| `running` | worker 在跑（带 `lease.pid` / `startTicks` / 心跳） | 判孤儿：活着就 SIGKILL 进程组，然后发中断告知；**不自动重跑** |
| `answered` | 正文已落盘、未发完 | 按 `parts[].hash` 只补发缺失块，不重新跑模型 |
| `done` / `failed` / `cancelled` / `interrupted` | 终态 | 清理（`done` 时清空正文） |

要点：

- **先落盘再产生副作用**：受理先写 job，worker 退出先写 `answer` 再回帖，每块回帖成功才写 `parts`。
- **恰好一次**：`seen[dedupeId]` 指向 job id，重复投递只会推进同一个 job；`parts[].hash` 让已发内容不重发。
- **重跑由人决定**：`running` 被打断时不自动重做（worker 里的写操作不可幂等）。回复 `/重跑`（或 `/rerun`）把最近一个 `interrupted` job 变成新 attempt，`dedupeId` 加 `#retry<n>`。
- **停止**：`停`、`stop`、`/stop` 取消当前轮。
- 恢复扫描在适配器 `onReady` 之后执行一次（`relay.mjs`），因此崩溃后第一件事是把没跑完的 job 收敛掉。

## 升级

铁律：**只等 job 归零后重启，绝不打断进行中的任务**。任何情况下都不允许「等够时间就强杀」——`running` 被杀的代价是 worker 写操作半途而废且不自动重做（只能人工 `/重跑`）。

`scripts/relay-upgrade.sh <platform>` 的规则：

- 轮询 state，直到 `queued|running|answered` 三类 job 全部归零，才 `systemctl --user restart`，10s 后探活；失败打印 journal 尾部并以非 0 退出。
- 等待**默认无上限**（`RELAY_UPGRADE_WAIT=0`）。设了正数上限时，超时只打印告警并 `exit 3`，**保持 relay 原样不动**，等下次空闲再跑；不存在「超时后照旧重启」的分支。
- 日志按状态变化打一行（`N job(s) in flight (job-211,...)`），空闲时每 `RELAY_UPGRADE_HEARTBEAT`（默认 300s）打一次心跳，不刷屏。
- 发起方式：直接在任意 shell 跑 `scripts/relay-upgrade.sh <platform>` 即可。它发现自己还在 `relay@<platform>.service` 的 cgroup 里时，会自动 `systemd-run --user --collect` 成 `relay-upgrade-<platform>`（transient service，退出即清理）再干活，命令立即返回，重启不会把等待者一起杀掉；输出用 `journalctl --user -u relay-upgrade-<platform>` 看。若 `systemd-run` 失败则退化为原地等待并先打一条 WARN（此时重启可能把自己杀掉，探活会缺）。
- 取消等待：`systemctl --user stop relay-upgrade-<platform>`（或 `pkill -f 'relay-upgrade.sh <platform>'`），relay 不受影响。
- 重启探活后**主动推一条消息**给 Hao（复用 `relay.mjs notify <platform>`）：成功推 `🔄 relay-<platform> 已重启，健康检查通过（pid …）`，失败推 `🔴 … 需要人工看一下`。`RELAY_UPGRADE_NOTIFY=0` 可关掉；`bun` 缺失或推失败只打 WARN，不影响退出码。
- 不要在等待窗口里手工 `systemctl stop` 后再串后续命令——历史事故原因见 topicbox spec 01 Notes。

## 测试

```bash
node --test loops/relay/*.test.mjs loops/relay/adapters/*.test.mjs
```

不要用 `npm test`：`package.json` 声明了 `packageManager: pnpm@...`，corepack 会拦截 `npm` 并联网下载 pnpm，在 WSL 上静默挂住。

用例必须零网络、零真实状态写入（临时目录），平台 SDK 只在装配层 import；行为变更与用例同 PR。

## 新增一个平台

1. 写 `loops/relay/adapters/<platform>.mjs`：`createAdapter({ paths, readEnv, log })` 返回 `{ name, surface?, allowedUser, chunkLimit, timeoutMs, maxWorkers, queueDepth, worker, piBin, replyRules, start({ onMessage, core }), reply, notify?, onProgress?, onProgressDone? }`（`surface` 为可选，缺失回退 `"本会话"`，用于模板里的「发回哪里」）
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
