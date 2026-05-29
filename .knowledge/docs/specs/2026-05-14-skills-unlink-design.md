# Design: sync-claude-skills 增加 unlink 与增量清理

**日期**: 2026-05-14
**状态**: 已定稿
**仓库**: `agents-for-myself`

## 1. 背景与目标

`bin/sync-claude-skills` 目前只负责"安装"——将 canonical skills tree 中的 leaf skill 目录以扁平 symlink 的形式同步到 `~/.claude/skills`。它缺少对应的"卸载"能力，也无法自动清理 canonical tree 中已删除 skill 的残留 symlink。

**目标：**
- 增加 `unlink` 子命令，支持完全卸载所有由本脚本管理的 symlink。
- `link` 默认增加增量清理行为：自动删除 canonical tree 中已不存在的 skill 对应的 symlink。
- 安全边界与 `bin/maintain-instructions-symlinks` 对齐。

## 2. CLI 接口

```
Usage: sync-claude-skills [link|unlink] [options]

Commands:
  link    创建/更新 symlink，并增量清理已不存在的 skill（默认）
  unlink  删除 ~/.claude/skills 下所有指向本仓库 skills 的 symlink

Options:
  -s, --source PATH     Canonical skills 根目录（默认: ~/agents-for-myself/skills）
  -t, --target PATH     Claude skills 目录（默认: ~/.claude/skills）
  --no-prune            link 时禁用增量清理
  --dry-run             只打印操作，不写盘
  -h, --help            帮助
```

**兼容性：** 无参数调用保持向后兼容，行为从"仅创建/更新"变为"创建/更新 + 增量清理"。

## 3. link 语义（含默认增量清理）

### 3.1 扫描阶段

与现有逻辑一致：
1. 递归扫描 `$SRC`，找到所有包含 `SKILL.md` 的 leaf 目录。
2. 扁平化命名：若顶层目录直接包含 `SKILL.md`，以其目录名为 skill 名；若顶层为分类目录（不含 `SKILL.md`），以其子目录名为 skill 名。
3. 检测同名冲突：若两个不同路径解析为同一个 skill 名，报错退出（exit 3）。

### 3.2 创建/更新阶段

对扫描得到的每个 skill：
- 目标路径：`$DST/<skill-name>`
- 执行 `ln -sfn <canonical-path> <target-path>`
- 若 `$DST/<skill-name>` 存在且为非 symlink，报错退出（exit 4）。

### 3.3 增量清理阶段（默认启用，可通过 `--no-prune` 禁用）

1. 遍历 `$DST` 下的所有条目。
2. 对每条目 `L`：
   - 若 `L` 不是 symlink：跳过（不碰用户手动创建的文件/目录）。
   - 若 `L` 是 symlink：计算 `T=$(readlink -f "$L" 2>/dev/null)`。
     - 若 `T` 为空（断链）：跳过，打印 warning。
     - 若 `T` 指向 `$SRC` 路径前缀，且 `L` 的名称**不在**本次扫描得到的 skill 列表中：删除该 symlink。
     - 若 `T` 指向 `$SRC` 路径前缀，且 `L` 的名称**在** skill 列表中：保留（正常更新已在 3.2 阶段完成）。
     - 若 `T` 指向 `$SRC` 外：跳过（不碰用户手动创建的外部链接）。

**幂等性：** 重复执行 `link` 结果一致。增量清理只删"本脚本管理范围内且已不存在"的 symlink。

## 4. unlink 语义

对 `$DST` 下的所有条目 `L`：
1. `L` 不存在：跳过（幂等）。
2. `L` 存在且不是 symlink：打印 warning，跳过（不删除）。
3. `L` 为 symlink：
   - 计算 `T=$(readlink -f "$L" 2>/dev/null)`。
   - 若 `T` 为空（断链）：打印 warning，跳过（不删除）。
   - 若 `T` 为 `$SRC` 路径前缀（规范化后的 canonical root 下）：删除该 symlink。
   - 若 `T` 为 `$SRC` 外：跳过（不碰外部链接）。

**安全边界：** 仅处理 `$DST` 下的直接条目，不递归；不碰非 symlink；不碰断链；不碰外部链接。

## 5. 与现有脚本的对比

| 行为 | `maintain-instructions-symlinks` | `sync-claude-skills`（本设计） |
|------|----------------------------------|-------------------------------|
| 清单来源 | 显式 manifest 文件 | 动态扫描目录树 |
| link 目标 | manifest 中列出的固定路径 | `$DST` 下动态发现的 skill 名 |
| unlink 范围 | manifest 中列出的路径 | `$DST` 下所有指向 `$SRC` 的 symlink |
| 非 symlink 占名 | 报错退出 | link 时报错退出，unlink 时 warning 跳过 |
| 断链 symlink | warning 跳过 | warning 跳过 |
| 增量清理 | 无 | link 默认启用，可 `--no-prune` 禁用 |

## 6. 错误码

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 |
| 1 | 源目录不存在 |
| 3 | skill 名冲突（两个不同路径解析为同名） |
| 4 | 目标路径被非 symlink 文件占用 |

## 7. 验证建议

1. **--dry-run link**：创建新 skill、修改现有 skill、删除一个旧 skill 后运行，确认输出包含创建、更新、删除三类操作的 dry-run 打印。
2. **link 幂等**：连续运行两次，第二次应无变化（无创建、无删除）。
3. **unlink 后验证**：`ls ~/.claude/skills` 下无指向 `$SRC` 的 symlink；非 symlink 文件和外部链接保留。
4. **断链处理**：手动创建一条指向 `$SRC` 的断链 symlink，运行 `unlink` 确认不删除且打印 warning。
5. **--no-prune**：删除 canonical tree 中一个 skill 后，`link --no-prune` 应保留其残留 symlink。

## 8. 非目标

- 不维护状态文件或 manifest。
- 不递归清理 `$DST` 的子目录（仅处理 `$DST` 的直接条目）。
- 不自动创建或删除 `$DST` 目录本身。
- 不提供按名称单独 unlink 某个 skill 的功能（首版不做）。
