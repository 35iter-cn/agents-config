# feishud

飞书群侧的会话桥：接 `im.message.receive_v1` 事件，按话题/非话题派生 pi session，把 agent 输出回复到原位置。Telegram 侧仍由 `loops/tgd` 负责，两者互不影响。

## 角色分工

- `notify.mjs` — 单向推送。intake loop 用它把候选发到飞书群。纯 `fetch`，无依赖。
- `bridge.mjs` — 双向对话。长连接收事件 → 起 `pi --session-id` → 回复到群/话题。
- `prompts/thread.md` — 新会话首轮的注入提示词（角色、回帖格式、工作方式、边界）。

## 凭据与配置

`~/.config/taskradar/feishu.env`（权限 0600）：

```
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
FEISHU_CHAT_ID=oc_...        # notify.mjs 的目标群
```

`bridge.mjs` 的额外环境变量：

- `TGD_ALLOWED_OPEN_ID` — 只处理该用户的发言（默认 Hao 的 open_id）
- `TGD_WORKER` — `pi`（默认）或 `stub`（只回显，用于验证管道）

## 运行

```bash
~/.bun/bin/bun loops/feishud/notify.mjs "<文本>"
TGD_WORKER=pi ~/.bun/bin/bun loops/feishud/bridge.mjs
```

## 会话规则

- 有 `thread_id` / `root_id` / `parent_id` → 会话 key `th-<root>`，同一话题复用同一 session
- 都没有 → 会话 key `ms-<message_id>`，每条新消息一个 session

## 注意

- 飞书长连接是集群模式：同一应用多个客户端同时连时，每条事件只随机投递给其中一个。**全局只允许跑一个 bridge 进程**，否则事件会丢给别的消费者。
- 子进程必须以 `stdio: ["ignore","pipe","pipe"]` 启动，否则 stdin 是永不关闭的管道，pi 会一直等输入而挂住。
- 回复走 `interactive` 卡片（schema 2.0 + `markdown` 元素）才能渲染 Markdown；纯 `text` 消息会把 `**粗体**`、代码围栏原样显示。卡片发送失败会自动降级为纯文本。
