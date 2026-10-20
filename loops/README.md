# Loops

定时扫描循环跑在 systemd user timer 上，事件驱动的会话跑在常驻 service 上：环境存活才运行、关机即停，停机窗口的增量由水位在下轮一次补扫。

intake 是「单轮扫描 + 事件驱动会话」两件套：`intake.sh`（30min 定时扫描 GitHub 两源与 Slack，只读 + 推候选）和 `slackd`（常驻守护进程，`#agent-intake` 里每条消息一到就起一条 pi 会话，不等 timer）。

## 结构

每个循环一个 `<slug>/` 目录，自含运行时，互不共享状态：

```
loops/<slug>/
├── <slug>.sh            # 定时型主轮入口：flock 防重叠 + cd ~/code + pi --mode json --print
├── <slug>.mjs           # 常驻型入口（bun 运行时，事件源驱动）
├── prompts/<X>.md       # 每轮 / 每会话固定 prompt
├── .lock                # flock 文件（定时型）
└── systemd/<slug>.{service,timer}   # 定时型；常驻型只有 .service（Restart=always）
```

运行时日志不写仓内，见《日志与保留》。通用红线写进 prompt：写操作按 Level 分层（L0 只允许 state 水位 / daily log / 专用通知频道推送），报告先于水位提交。外部凭据（如 webhook URL）放 `~/.config/taskradar/`，不入库。

## Timer 安装（定时型，per slug）

```bash
for u in <slug>; do
  ln -sf "$(pwd)/loops/<slug>/systemd/$u.service" ~/.config/systemd/user/
  ln -sf "$(pwd)/loops/<slug>/systemd/$u.timer"  ~/.config/systemd/user/
  systemctl --user enable --now "$u.timer"
done
systemctl --user daemon-reload
```

service 的 `ExecStart` 指向 `%h/code/agents-config/loops/<slug>/<slug>.sh`（main checkout 路径）——worktree 里调试时手动 `bash loops/<slug>/<slug>.sh`，启用 timer 前先把改动合回 main。

## 常驻型安装（`slackd`）

```bash
ln -sf "$(pwd)/loops/slackd/systemd/slackd.service" ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now slackd.service
systemctl --user show -p ExecStart slackd.service
```

只链 `.service`、不启用 timer：事件由 Slack Socket Mode 推来。`ExecStart` 必须解析成 `%h/.bun/bin/bun %h/code/agents-config/loops/<slug>/<slug>.mjs`；日志看 `journalctl --user -u slackd -n 50` 与 `~/.config/taskradar/logs/slackd/`。

## 新增一个循环

1. `cp -r intake/<new-slug>` 后重命名 sh/unit 文件里的 slug
2. 重写 `prompts/`，替换取数源头与红线（沿用"三处允许写 + Level 分层"格式）
3. 初始化外置 state 文件（路径在 sh 的 `TASKRADAR_STATE`；按新源头定义初始水位）
4. 日志一律写 `~/.config/taskradar/logs/<slug>/`，不要在仓内建 `logs/`
5. 有事件源（如 Slack Socket Mode）时不要加次轮 timer，直接做常驻 service + thread 会话
6. 常驻 service 必须 `Restart=always` + `StartLimitIntervalSec=0`，并在入口里自行补齐 `PATH`（systemd user env 缺 volta / bun）
7. 安装（见上），`systemctl --user list-timers` 确认

## 水位规则

- 外置 state 文件是唯一跨轮状态；写入用「脚本内 read → 改单键 → tmp + `mv`」一步完成，禁止用编辑工具把整份快照盖回去
- state 只放增量游标（渠道水位 / 板列基线 / 已知候选 / 上次扫描时间），不放候选台账——候选的上下文是频道消息与 thread
- 失败轮/超时轮不推进水位（下轮重扫同一窗口），但异常要写进当日 daily log
- 水位只增不减；源头重构（换频道/换列）时人工重置

## 日志与保留

- 路径：`~/.config/taskradar/logs/{intake,slackd}/`；`intake.sh` 每轮开始自删 72h 之前的文件，`slackd` 启动时与每 24h 各清一次
- 仓内禁止出现 `loops/*/logs/`（`.gitignore` 仍保留该规则，但不再有目录）
- 保留窗口 72h：JSONL 只服务「刚出了什么事」的定位；需要长久结论的写 daily log / STATE.md / topicbox
- worker 的 stderr 与退出码落在 `logs/slackd/worker-*.log`；`thread` 会话的工具调用明细在 pi session jsonl 里（`~/.pi/agent/sessions/--home-manooog-code--/`）
