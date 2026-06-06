# runx Prompt 临时文件动态命名设计

## 背景与动机

Claude Code plan 模式下的 plan 文件采用 `{adjective}-{noun}.md` 动态命名（如 `happy-cat.md`），具有以下优点：

- **可读性**：人类可读的名称，便于在文件系统中快速识别
- **唯一性**：随机组合天然避免碰撞
- **无状态**：不需要维护全局计数器或时间戳单调性

runx skill 当前生成 prompt 临时文件时，由 AI 自行决定文件名，缺乏统一规范。本设计引入相同的命名理念，并趁机统一 `/tmp/companions/` 目录下两类文件的命名风格。

## 统一命名规则

| 文件类型 | 存放目录 | 命名格式 | 示例 |
|---------|---------|---------|------|
| 原始日志 (.jsonl) | `/tmp/companions/` | `raw-{YYYY-MM-DD-HH-mm}-{uuid8}.jsonl` | `raw-2026-06-06-11-09-5d9cfa43.jsonl` |
| Prompt 临时文件 (.md) | `/tmp/companions/` | `prompt-{adjective}-{noun}.md` | `prompt-happy-cat.md` |

### 命名前缀

- **`raw-`**：明确标识原始日志（companion 输出流），与 prompt 文件区分
- **`prompt-`**：明确标识 prompt 临时文件

### 时区统一

日志文件时间戳改用**系统本地时区**（当前硬编码 UTC），与 prompt 文件的行为一致（无显式时区偏移）。

## 新增模块设计

### 文件结构

```
skills/companions/scripts/lib/
├── tmpfile.mjs              # 路径生成核心逻辑 + CLI 入口
├── words/
│   ├── adjectives.mjs       # 形容词词库
│   └── nouns.mjs            # 名词词库
```

### 词库

- **adjectives.mjs**：约 100 个常见积极/中性形容词（happy, bright, calm, eager 等）
- **nouns.mjs**：约 100 个常见自然/抽象名词（river, ember, forest, echo 等）
- 词库可独立扩展，不影响核心逻辑

### tmpfile.mjs API

```javascript
// 生成完整临时文件路径
export function generateTmpfilePath(options = {}) {
  // options.prefix  - 默认 'prompt'
  // options.dir     - 默认 '/tmp/companions'
  // options.ext     - 默认 '.md'
  // options.retries - 默认 10
}

// CLI 入口（被 companion.mjs 调用）
export function main(argv) { ... }
```

### 碰撞检测

1. 随机选取 adjective + noun
2. 拼接完整路径：`{dir}/{prefix}-{adjective}-{noun}{ext}`
3. 若文件已存在，重新随机选取（最多重试 10 次）
4. 目录不存在时自动创建（`mkdirSync(..., { recursive: true })`）
5. 若仍碰撞，抛出错误

## companion.mjs 子命令

新增 `tmpfile` 命令，与现有的 `launch`、`models` 并列：

```bash
# 基本用法
node companion.mjs tmpfile
# 输出：/tmp/companions/prompt-happy-cat.md

# 自定义参数
node companion.mjs tmpfile --prefix debug --ext .txt
# 输出：/tmp/companions/debug-bright-river.txt
```

### 命令参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--prefix <str>` | 文件名前缀 | `prompt` |
| `--dir <path>` | 目标目录 | `/tmp/companions` |
| `--ext <ext>` | 文件扩展名 | `.md` |

### 实现位置

在 `companion.mjs` 的 `main()` 函数中新增分支：

```javascript
if (command === 'tmpfile') {
  // 解析 --prefix, --dir, --ext
  // 调用 generateTmpfilePath()
  // stdoutWrite(path + '\n')
  // exit(0)
}
```

## runner.mjs 日志改造

**当前代码**（第 174-181 行）：

```javascript
const logDir = '/tmp/companions';
mkdirSync(logDir, { recursive: true });
const timestamp = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
  timeZone: 'UTC',
}).format(new Date()).replace(' ', '-');
const logPath = options.logPath ?? `${logDir}/${timestamp}-${randomUUID().slice(0, 8)}.jsonl`;
```

**改造后**：

```javascript
const logDir = '/tmp/companions';
mkdirSync(logDir, { recursive: true });
const now = new Date();
const timestamp = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
  String(now.getHours()).padStart(2, '0'),
  String(now.getMinutes()).padStart(2, '0'),
].join('-');
const logPath = options.logPath ?? `${logDir}/raw-${timestamp}-${randomUUID().slice(0, 8)}.jsonl`;
```

**改动点**：
1. 加 `raw-` 前缀
2. 去掉 `Intl.DateTimeFormat`，改用手动拼接（系统本地时区）
3. 去掉 `.replace(' ', '-')`（手动拼接无空格）

## SKILL.md 改写

### Step 2 更新

原文：

> **Step 2:** Write `$finalPrompt` to a temporary file (`$tmpfile`).

改为：

> **Step 2:** 生成临时文件路径并写入 `$finalPrompt`。
>
> ```bash
> $tmpfile = $(node "$script_path" tmpfile)
> echo "$finalPrompt" > "$tmpfile"
> ```
>
> `companion.mjs tmpfile` 自动生成 `/tmp/companions/prompt-{adjective}-{noun}.md`，
> 包含碰撞检测（最多重试 10 次）。`$script_path` 定义见下文。

### 执行命令不变

```bash
node "$script_path" launch --companion $companion --modelTier $modelTier --prompt-path $tmpfile
```

## 改动文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `skills/companions/scripts/lib/tmpfile.mjs` | 新增 | 路径生成核心逻辑 |
| `skills/companions/scripts/lib/words/adjectives.mjs` | 新增 | 形容词词库 |
| `skills/companions/scripts/lib/words/nouns.mjs` | 新增 | 名词词库 |
| `skills/companions/scripts/lib/companion.mjs` | 修改 | 新增 `tmpfile` 子命令 |
| `skills/companions/scripts/lib/runner.mjs` | 修改 | 日志命名加 `raw-` 前缀，改用系统时区 |
| `skills/companions/runx/SKILL.md` | 修改 | Step 2 使用 `tmpfile` 命令生成路径 |

## Summary 输出改造

### 目标

- **当前**：summary 通过 stdout 的 done marker JSON 直接内联输出
- **改造后**：summary 单独写成 JSONL 文件到 `/tmp/companions/`，done marker 中通过 `summaryPath` 字段引用该文件

### 文件名规则

复用 prompt 文件的命名构造：

| prompt 文件 | summary 文件 |
|------------|-------------|
| `prompt-happy-cat.md` | `summary-happy-cat.jsonl` |

**提取规则**：
1. 从 `--prompt-path` 提取 basename（如 `prompt-happy-cat.md`）
2. 去掉 `prompt-` 前缀（如果存在）
3. 去掉 `.md` 扩展名
4. 拼接为 `summary-{adjective}-{noun}.jsonl`

**Fallback**：若 prompt 文件名不符合 `prompt-*.md` 格式，则直接使用 basename 去掉扩展名。如 `/tmp/my-prompt.md` → `summary-my-prompt.jsonl`。

### 数据流

```
companion.mjs
  ├── 解析 --prompt-path
  ├── 提取 sessionName = "happy-cat"
  │
  ├──► runner.mjs (传入 options.sessionName)
  │      ├── 原始日志 → /tmp/companions/raw-2026-06-06-11-09-xxx.jsonl
  │      ├── stdout 输出 JSONL 流（started, heartbeat, retry, done）
  │      │          done marker 格式：
  │      │          {"type":"done", "success":true, "summaryPath":"/tmp/companions/summary-happy-cat.jsonl", ...}
  │      │
  │      └── 最终 summary → 写入 /tmp/companions/summary-happy-cat.jsonl
  │
  └── 读取 summaryPath 文件，返回结果
```

### companion.mjs 改动

新增 `sessionName` 提取逻辑：

```javascript
function extractSessionName(promptPath) {
  const basename = path.basename(promptPath);
  const name = basename.replace(/^prompt-/, '').replace(/\.md$/, '');
  return name || 'unknown';
}

// 传给 runner
const result = await runCompanionFn(..., {
  ...,
  sessionName: extractSessionName(parsed.promptPath),
});
```

### runner.mjs 改动

1. `runSingleAttempt` 接收 `options.sessionName`
2. `runLoop().then()` 中，在输出 done marker **之前**：
   - 将 `summary` 对象序列化为 JSON
   - 写入 `${logDir}/summary-${sessionName}.jsonl`
   - 在 done marker 中增加 `summaryPath` 字段

```javascript
const summaryPath = `${logDir}/summary-${sessionName}.jsonl`;
writeFileSync(summaryPath, JSON.stringify(summary) + '\n');
writeLine(createDoneMarker(outcome.result, summary, summaryPath));
```

### done marker 格式变更

**当前**：
```json
{"type":"done","success":true,"exitCode":0,"durationMs":1234,"summary":{...}}
```

**改造后**：
```json
{"type":"done","success":true,"exitCode":0,"durationMs":1234,"summaryPath":"/tmp/companions/summary-happy-cat.jsonl"}
```

`summary` 字段不再内联，改为 `summaryPath` 指向外部文件。

## SKILL.md 改写（续）

### Handle Response 更新

原文（直接解析 done marker 中的 `summary` 字段）：

> The companion streams output, ending with a final JSON line:
> ```
> {"type":"done","success":bool,"summary":{"finalMessage":"...","sessionID":"...","sessionError":"..."}}
> ```
> **Response paths**
> | Path | Trigger | Action |
> | ---- | ------- | ------ |
> | Error | `sessionError` present | Report error and stop |
> | Decision | `[NEEDS_DECISION]` in `finalMessage` | ... |
> | Default | Neither above | Summarize companion's results |

改为：

> The companion streams output, ending with a final JSON line (done marker):
> ```
> {"type":"done","success":bool,"summaryPath":"/tmp/companions/summary-happy-cat.jsonl"}
> ```
>
> **Read the summary file** from `summaryPath`, then follow response paths:
>
> | Path | Trigger | Action |
> | ---- | ------- | ------ |
> | Error | `sessionError` present in summary | Report error and stop |
> | Decision | `[NEEDS_DECISION]` in `finalMessage` | ... |
> | Default | Neither above | Summarize companion's results |

## 改动文件清单（最终）

| 文件 | 操作 | 说明 |
|------|------|------|
| `skills/companions/scripts/lib/tmpfile.mjs` | 新增 | 路径生成核心逻辑 |
| `skills/companions/scripts/lib/words/adjectives.mjs` | 新增 | 形容词词库 |
| `skills/companions/scripts/lib/words/nouns.mjs` | 新增 | 名词词库 |
| `skills/companions/scripts/lib/companion.mjs` | 修改 | 新增 `tmpfile` 子命令；提取 `sessionName` 传入 runner |
| `skills/companions/scripts/lib/runner.mjs` | 修改 | 日志命名加 `raw-` 前缀，改用系统时区；summary 写入独立文件 |
| `skills/companions/runx/SKILL.md` | 修改 | Step 2 使用 `tmpfile` 命令；Handle Response 读取 summary 文件 |

## 生命周期

- **Prompt 临时文件**：不内建清理逻辑，依赖系统 `/tmp` 的自动管理机制
- **Summary 文件**：不内建清理逻辑，与 prompt 文件生命周期一致
- **原始日志**：保持现有逻辑（`cleanupAgentshubLogs()` 在 `runCompanion()` 启动前自动清理旧日志）
