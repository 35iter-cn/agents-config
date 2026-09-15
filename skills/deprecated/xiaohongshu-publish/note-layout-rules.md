# Note Layout Rules — 小红书图文笔记排版规则

Reusable layout recipe for Xiaohongshu image-text notes (干货/技术/省钱向). Abstracted from a real published note (2026-08, DeepSeek 订阅对比). Reference from [SKILL.md](SKILL.md) §5.

## Title (标题)

- **≤ 20 chars**, core keyword up front, one hook (悬念/反差/数字).
- Example: `比DeepSeek官方更划算的订阅是它！` (20 chars)

## Body structure (正文结构)

### 1. Paragraphs: short, airy

- Every line its own paragraph, **1–2 lines each**, never a dense block.
- Blank line between paragraphs (editor: content paragraph, blank paragraph, content…).
- A dense single block reads as a wall of text and gets skipped.

### 2. Icon anchors (icon 锚点)

Open each section with an emoji that matches its job:

| Icon | Section job | Example use |
|------|-------------|-------------|
| 💸 | 价格/算账 | opening cost claim |
| 📊 | 数据/列举 | API 按量价 breakdown |
| 🤔 | 反问/纠偏 | "你以为 X 很省钱？" |
| 🚀 | 转折/方案 | subscription alternative |
| 🗣️ | 互动/提问 | 评论区聊聊 |
| 👍 | 引导/钩子 | 点赞多下期 |

One icon per section; don't stack multiple emoji per line.

### 3. Numbers, not adjectives

State exact values: `$0.14 / $0.28 / $0.0028（每百万 token）`, `6 倍额度` — never "很便宜/很贵". Numbers are the discussion fuel.

### 4. Punch line as its own paragraph

The contrarian take gets its own short line: `真正的大头是输出。`

### 5. Discussion ending (互动结尾)

Close with a question + a hook:

```
🗣️ 评论区聊聊：
你会选 A，还是 B？
或者你已经在用更划算的渠道？

👍 点赞多的话，下期拆解…
```

## Hashtags (话题)

- Inline at body end, space-separated: `#DeepSeek #AI编程 #AI工具 #程序员日常`
- **3–6 tags**: 1–2 core keywords + broad traffic keywords.
- Count toward the 1000-char body limit.
- Never open the topic picker (see SKILL.md Pitfalls).

## Editor implementation (tiptap/ProseMirror)

- `fill` folds newlines into spaces — **use `execCommand('insertText')`**.
- `\n` = paragraph break; `\n\n` = paragraph + blank line (spacing).
- Clear first (selectAll + insertText('')), wait ~150ms, then insert — same-sync calls race and drop content.
- Verify: `document.querySelectorAll('.tiptap p').length` = content paragraphs + blanks.

## Example (published, 2026-08)

```
比DeepSeek官方更划算的订阅是它！

💸 算完这笔账，我发现 DeepSeek 官方 API 其实没那么便宜。

📊 以 V4 Flash 为例，按量价：
输入 $0.14 / 输出 $0.28 / 缓存读取 $0.0028（每百万 token）

🤔 你以为缓存命中很省钱？
重度编码时 90%+ token 都在读缓存，真正的大头是输出。

🚀 但换订阅制（OpenCode Go，$10/月）：
同样预算能拿到官方按量 6 倍额度——编码场景几乎全是缓存命中，规模采购把单价打到地板。

🗣️ 评论区聊聊：
你会选官方 API 按量，还是订阅包月？
或者你已经在用更划算的渠道？

👍 点赞多的话，下期拆解各家订阅的隐藏坑！

#DeepSeek #AI编程 #AI工具 #程序员日常
```
