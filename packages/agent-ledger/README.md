# agent-ledger

Pi 扩展：每轮对话结束（`agent_settled`）时往 `~/.config/agent-hours/ledger/<sessionId>.jsonl` 追加一行结构化账目。只记账，不判定、不写 Clock —— 判定与同步在 spec 06 的 service 侧，本包是它的数据源。

## 账目字段

```jsonc
{ "v": 1,
  "id": "<sessionId>:<startedAt>",          // 幂等主键，同一 session 不会有两轮落在同一毫秒
  "sessionId": "fs-th-om_x100b...",
  "sessionFile": "/home/…/2026-10-23T10-11-58_fs-th-….jsonl",
  "source": "relay | automation | interactive",
  "startedAt": "2026-10-23T10:12:03.441Z",
  "durationMs": 184320,                      // 首個 agent_start 到 agent_settled 的墙钟，不裁不截
  "userText": "本轮用户原文，截 600 字",
  "output": "最后一条 assistant 文本，截 400 字",
  "aborted": false }
```

`source` 判定顺序：`AGENT_LEDGER_SOURCE` → `RELAY_PLATFORM` → session 文件名含 `_fs-` / `_sl-` / `_tg-` → `interactive`。

## 安装

```bash
pi install /path/to/agents-config/packages/agent-ledger
pi list                       # 确认已登记
```

开发期不装也能试：`pi --print --extension ./packages/agent-ledger/src/extension.ts "只回复：ok"`。

包内 `package.json` 的 `pi.extensions` 指向 `./src/extension.ts`，Pi 用 jiti 直接加载 TS，无编译步骤。`src/ledger.mjs` 是纯逻辑（可 `node --test` 的 15 例在 `src/ledger.test.mjs`）。

`pi install` 记录的是**绝对路径**，所以从 topic worktree 安装的话，合并后要重指：

```bash
pi remove /path/to/…/worktree-agents-config/packages/agent-ledger
pi install ~/code/agents-config/packages/agent-ledger
```

## 观察

```bash
node packages/agent-ledger/bin/summary.mjs              # 最近 7 天，按本地日汇总
node packages/agent-ledger/bin/summary.mjs ~/.config/agent-hours/ledger 30
tail -3 ~/.config/agent-hours/ledger/<sessionId>.jsonl
```

`AGENT_HOURS_DIR` 可改根目录（默认 `~/.config/agent-hours`），试跑时用它隔离。

## 安全边界

账目写盘全包 try/catch，失败只写 stderr，绝不改变 turn 结果、不阻断回帖。目录 `0700`、文件 `0600`；单行按 `MAX_LINE_BYTES = 3800` 收缩（先清 `output`，再缩 `userText`），保证 `O_APPEND` 单次写入的原子性。

`durationMs` 是真实墙钟，不设上限：一轮跑了 45 分钟就记 45 分钟。等人回话发生在 run 之外（回帖即 `agent_settled`，下条消息才起新的 `agent_start`），所以这个区间里没有天然不该记的时间。

## 卸载

```bash
pi remove /path/to/agents-config/packages/agent-ledger
```

已落盘的账目不受影响；`rm -rf ~/.config/agent-hours` 可整体清空。
