# companion CLI 参数重命名与 --help 支持

date: 2026-06-03

## 背景

`skills/companions/scripts/companion.mjs` 是一个委派任务给外部 AI agent 的 CLI 工具，支持 `run` 和 `models` 两个子命令。当前 `run` 子命令使用 `--agent` 和 `--model` 参数，命名不够精确。本次设计将其重命名为 `--companion` 和 `--modelTier`，并添加 `--help` 支持。

## 目标

1. CLI 参数重命名（不保留向后兼容）
2. 内部变量与 CLI 参数保持命名一致
3. 添加 `-h` / `--help` 支持
4. 同步更新测试和技能文档

## 参数重命名映射

| 旧参数 | 新参数 | 用途 |
|--------|--------|------|
| `--agent <name>` | `--companion <name>` | 指定 companion 类型 |
| `--model <tier>` | `--modelTier <tier>` | 指定模型层级 |

`--dry-run`、`--session` 保持不变。`models` 子命令的参数（`--list`, `--get`, `--set`, `--reset`）也保持不变。

## --help 输出格式

```
Usage: companion <command> [options]

Commands:
  run [prompt]           Run a companion agent. If [prompt] is omitted, reads from stdin.
  models                 Manage model configurations

Run options:
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

## 内部变量重命名

- `parseRunArguments()` 返回的字段：`agent` → `companion`
- `main()` 传递给 `runCompanion()` 的 `options` 对象：`options.agent` → `options.companion`
- `runner.mjs` 中 `AGENTS` 配置里的 `options.agent` 引用 → `options.companion`

## 影响文件与修改内容

| 文件 | 修改内容 |
|------|----------|
| `scripts/lib/companion.mjs` | 参数解析逻辑、--help 支持、内部字段名 `agent` → `companion` |
| `scripts/lib/runner.mjs` | `options.agent` → `options.companion` |
| `tests/opencode-companion.test.mjs` | 所有 `--agent` → `--companion`，断言字段 `agent` → `companion` |
| `runx/SKILL.md` | 第 132 行示例：`--agent` → `--companion`，`--model` → `--modelTier` |
| `tune/SKILL.md` | 第 92 行提及的参数名同步更新 |

## --help 实现行为

- 支持 `-h` 和 `--help` 两种形式
- 出现在任何位置都触发 help 输出（如 `companion --help`、`companion run --help`）
- 输出到 stdout，exit code 为 0

## 测试策略

- 同步更新现有测试用例中的参数字符串和断言字段
- 新增 `--help` 测试用例，验证输出包含关键信息（如 `Usage:`、`Commands:`、`--companion`）
- 运行全部测试确保无回归
