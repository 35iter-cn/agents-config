# companion CLI：新增 --prompt-path 参数，移除位置参数与 stdin 输入

date: 2026-06-06

## 背景

`skills/companions/scripts/companion.mjs` 是一个委派任务给外部 AI agent 的 CLI 工具。

当前 `run` 子命令支持以下 prompt 传入方式：
1. 位置参数 `[prompt]` 直接传入
2. 省略时通过 `stdinHasData()` 检测 FIFO/管道，从 stdin 读取

这两种方式存在歧义（位置参数 vs flag 参数混用），且管道输入在生产环境中难以追踪和复现。本次设计将其统一为显式的 `--prompt-path <path>` 文件读取方式。

同时，`run` 子命令更名为 `launch`，语义更清晰。

## 目标

1. `run` 子命令更名为 `launch`
2. 新增 `--prompt-path <path>` 参数，从指定文件读取 prompt（必需）
3. 移除位置参数 `[prompt]` 作为 prompt 的传入方式
4. 移除 `launch` 子命令的 stdin 管道读取模式
5. `models` 子命令保持不变（`--set` 仍通过 stdin 读取 JSON）
6. 同步更新 help 文本、测试和技能文档

## CLI 接口变更

### 命令重命名

| 旧命令 | 新命令 |
|--------|--------|
| `run` | `launch` |

### 参数变更

| 旧方式 | 新方式 | 状态 |
|--------|--------|------|
| `[prompt]` 位置参数 | `--prompt-path <path>` | **移除 → 新增** |
| stdin 管道输入 | 不再支持 | **移除** |
| `--companion <name>` | `--companion <name>` | 不变 |
| `--modelTier <tier>` | `--modelTier <tier>` | 不变 |
| `--session <id>` | `--session <id>` | 不变 |
| `--dry-run` | `--dry-run` | 不变 |

### 新 help 文本

```
Usage: companion <command> [options]

Commands:
  launch                 Launch a companion agent to process the prompt
  models                 Manage model configurations

Launch options:
  --prompt-path <path>   Path to the prompt file (required)
  --companion <name>     Companion type (opencode, cursor, omp, codex)
  --modelTier <tier>     Model tier (low, medium, high, maximum)
  --session <id>         Resume an existing session
  --dry-run              Show what would run without executing

Models options:
  --list                 List configured and available models
  --get [adaptor]        Get model configuration
  --set                  Set model configuration (reads JSON from stdin)
  --reset [adaptor]      Reset model configuration to defaults
```

## 内部变更

### `parseRunArguments()`

- 移除 `result.prompt` 字段
- 新增 `result.promptPath` 字段（`string | undefined`）
- 移除"第一个非 flag 参数作为 prompt"的隐式处理逻辑
- 新增 `--prompt-path <path>` 的显式解析

新返回结构：

```javascript
{
  promptPath: string | undefined,
  companion: string | undefined,
  modelTier: string | undefined,
  dryRun: boolean,
  session: string | undefined,
}
```

### `main()` 中 `launch` 分支

1. **命令匹配**：`command === 'run'` → `command === 'launch'`
2. **验证阶段**：`parsed.promptPath` 未定义时，输出错误到 stderr 并 exit(1)
3. **读取阶段**：`readFileSync(parsed.promptPath, 'utf-8').trimEnd()` 读取 prompt
4. **错误处理**：文件读取失败（ENOENT 等）时，捕获异常，输出 `Error: cannot read prompt file: <message>`，exit(1)
5. **清理阶段**：移除对 `stdinHasData()` 和 `readStdin()` 的调用（`models --set` 仍保留 `readStdin()`）

### `readStdin()` / `stdinHasData()`

- 保留在文件中（`models --set` 仍需使用）
- 仅在 `launch` 分支中移除调用

## 错误处理

| 场景 | 行为 | Exit code |
|------|------|-----------|
| 缺少 `--prompt-path` | `Error: --prompt-path is required` | 1 |
| 文件不存在 | `Error: cannot read prompt file: ENOENT: ...` | 1 |
| 文件读取权限不足 | `Error: cannot read prompt file: EACCES: ...` | 1 |
| 其他文件错误 | `Error: cannot read prompt file: <message>` | 1 |

## 测试更新

### 需删除的测试

- `main reads prompt from stdin when no positional arg and stdin has data`

### 需修改的测试

所有涉及 `run` 子命令的测试：
- `main dispatches run subcommand...` → `launch`
- `main exits non-zero when runOpencode fails` → `launch`
- `main passes dryRun to runOpencode...` → `launch`
- `main passes requested agent type to runCompanion` → `launch`
- `main passes modelTier to runCompanion...` → `launch`
- `main passes session option to runCompanion` → `launch`

所有 `parseRunArguments` 测试：
- `prompt` 字段断言 → `promptPath`
- 位置参数传 prompt 的用例 → 改为 `--prompt-path`

### 需新增的测试

- `parseRunArguments parses --prompt-path`
- `main requires --prompt-path and exits non-zero when missing`
- `main reads prompt from file when --prompt-path is provided`
- `main exits non-zero when prompt file does not exist`

### `--help` 测试更新

- 断言输出包含 `launch` 而非 `run`
- 断言输出包含 `--prompt-path` 而非 `run [prompt]`

## 影响文件清单

| 文件 | 修改内容 |
|------|----------|
| `skills/companions/scripts/lib/companion.mjs` | `parseRunArguments()`、`main()` launch 分支、help 文本 |
| `skills/companions/tests/opencode-companion.test.mjs` | 所有测试用例同步更新 |
| `skills/runx/SKILL.md` | 如有引用 `companion run`，同步改为 `companion launch --prompt-path` |
| `skills/tune/SKILL.md` | 如有引用，同步更新 |

**无需修改**：`scripts/lib/runner.mjs`（runner 只接收 `prompt` 字符串，不关心来源）。
