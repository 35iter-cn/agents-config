# Design: 规范文件迁入 `instructions/` 与 symlink 维护脚本

**日期**: 2026-05-14  
**状态**: 已定稿（实现前以本文为准）  
**仓库**: `agents-for-myself`（根路径下文记为 `$REPO`）

## 1. 背景与目标

- 将原位于 `/root/.agents/AGENTS.md` 的**单一规范源**迁入本仓库，并为后续多套配置预留结构。
- **移除**所有指向 `/root/.agents/AGENTS.md` 的既有符号链接，避免迁走后断链或残留。
- 在 `$REPO/bin/` 提供脚本，**一次性**维护各工具约定路径上的符号链接：创建/更新（`link`）或拆除（`unlink`）。
- **不在**仓库根创建指向规范文件的 `AGENTS.md` symlink（Cursor 若读项目根 `AGENTS.md`，由用户另行处理或依赖工具侧路径）。

## 2. 规范文件布局

- 目录：`$REPO/instructions/`（若不存在则在迁移或首次 `link` 前创建）。
- 默认规范文件：`$REPO/instructions/default.md`（由当前 `/root/.agents/AGENTS.md` **移动**而来，保持为普通文件）。
- 后续扩展：在同一目录下增加 `instructions/<stem>.md`，通过脚本 `-c <stem>` 切换，无需改目录结构。

## 3. 既有符号链接（迁移前需处理）

在实现阶段应对整盘或至少 `$HOME` 下做一次解析校验；已知曾指向 `/root/.agents/AGENTS.md` 的路径包括（以实施时扫描为准）：

- `$HOME/.config/opencode/AGENTS.md`
- `$HOME/.copilot/instructions.md`
- `$HOME/.claude/CLAUDE.md`
- `$HOME/.factory/AGENTS.md`（若仍存在）

迁移步骤：**先**删除或改写上述链接，**再**移动文件到 `instructions/default.md`，避免移动后目标不存在导致工具报错。

## 4. 脚本职责与命名

- **路径**: `$REPO/bin/` 下新增可执行脚本（建议名：`maintain-instructions-symlinks`；实现时可无扩展名）。
- **语言/风格**: Bash，`set -euo pipefail`；支持 `--dry-run`；用法说明 `--help`。
- **参考**: 与同目录 `sync-claude-skills` 的 CLI 习惯保持一致（短选项、环境变量覆盖、dry-run）。

## 5. 受管路径清单（manifest）

- 脚本维护一份**显式清单**（仅处理清单内路径，**不**全机扫描）。
- **存放**: 建议 `$REPO/bin/instructions-symlinks.paths`（每行一个绝对路径，或 `~` 展开为 `$HOME` 的路径）；忽略空行与 `#` 注释行。
- **初始内容**: 与 §3 中列出的工具路径一致（实施时以扫描结果核对）。
- **扩展**: 新增工具时只增删 manifest 行，不改核心逻辑。

## 6. CLI 约定

| 选项 | 含义 |
|------|------|
| `-r`, `--repo` | 仓库根 `$REPO`。默认：由脚本路径推导（`bin/` 的父目录），推导失败则报错。 |
| `-c`, `--canonical` | **仅 stem**，不含路径、**不含** `.md` 后缀；规范文件固定为 `$REPO/instructions/<stem>.md`。默认 stem：`default`。若 stem 含 `/`、以 `.` 开头等非法形态则报错。 |
| `--dry-run` | 只打印将执行的操作，不写盘。 |
| `-h`, `--help` | 帮助。 |

**子命令或模式**（二选一实现，须在 `--help` 中写清）：

- **`link`**（默认）：对 manifest 中每个 `L`：确保父目录存在；`ln -sf <规范绝对路径> <L>`（目标为 `instructions/<stem>.md` 的绝对路径）。
- **`unlink`**：见 §7。

## 7. `unlink` 语义（已定稿）

对 manifest 中每个路径 `L`：

1. **`L` 不存在**：跳过（幂等）。
2. **`L` 存在且不是 symlink**：**不删除**；打印 **warning**，继续。
3. **`L` 为 symlink**：计算 `T=$(readlink -f "$L" 2>/dev/null)`。  
   - 若 `T` 非空且为 **`$REPO` 路径前缀**（规范化后的仓库根下的路径）：执行 **unlink**（删除该 symlink 本身，不删仓库内目标文件）。  
   - 与当前 `-c` 推导出的规范文件**是否相同**不做要求（凡链入本仓库即卸）。  
4. **断链 symlink**（`readlink -f` 失败或 `T` 为空）：**不删除**；打印 **warning**（避免误删无法解析的链接）。可选：日后增加 `--force-broken` 再删，**首版不做**。

**安全边界**：仅处理 manifest 列出的 `L`；不对 `$REPO` 外做递归查找。

## 8. `link` 语义补充

- 使用 **`ln -sf`**，重复执行幂等。
- 规范目标路径始终为：`$(cd "$REPO" && pwd)/instructions/<stem>.md`（避免相对目标导致跨目录解析错误）。
- 若目标规范文件不存在：`link` 应 **失败退出**（避免创建指向不存在的断链，除非另有 `--allow-missing` 需求，**首版不做**）。

## 9. 迁移操作顺序（实施检查表）

1. 扫描并列出所有指向 `/root/.agents/AGENTS.md` 的 symlink。  
2. 删除这些 symlink（或先 `unlink` 若已存在新脚本与临时 manifest——首版可直接用 `rm` 已知路径）。  
3. 创建 `$REPO/instructions/`（若不存在）。  
4. 将 `/root/.agents/AGENTS.md` **移动**为 `$REPO/instructions/default.md`。  
5. 提交 manifest 与脚本后，执行 `link`（`-c` 默认 `default`）恢复各工具入口。

## 10. 非目标与后续

- **不**自动删除空目录 `/root/.agents/`（若用户需要可手动删）。  
- **不**在仓库根维护 `AGENTS.md` symlink。  
- **不**在首版实现 manifest 外的发现式扫描。  
- 后续可为不同 stem 维护多份 manifest 或增加 `--manifest PATH`，当前 spec 不要求。

## 11. 验证建议

- `--dry-run` 下 `link` / `unlink` 输出与预期一致。  
- `link` 后：`readlink -f` 各 `L` 均等于 `.../instructions/default.md`（在默认 stem 下）。  
- `unlink` 后：各 `L` 不存在或为未改动非 symlink；指向仓库外其他目标的 symlink 不被删除。  
- 普通文件误占 `L`：仅 warning，不被删除。

---

**说明**: 工作区当前无 `.git`，本设计文档未绑定 commit；若日后初始化 git，可将本文纳入版本控制。
