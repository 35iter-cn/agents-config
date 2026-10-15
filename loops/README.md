# Loops

定时扫描循环，跑在 systemd user timer 上：环境存活才运行、关机即停，停机窗口的增量由水位在下轮一次补扫。

intake loop 是双轮形态：`intake.sh`（主扫描，30min）与 `followup.sh`（pending 处理，10min；bash 层空队列快退零成本），状态共用同个 `state.json`。

## 结构

每个循环一个 `<slug>/` 目录，自含运行时，互不共享状态：

```
loops/<slug>/
├── <slug>.sh            # 主轮入口：flock 防重叠 + cd ~/code + pi --mode json --print
├── [followup.sh]        # 可选次轮：pending 变化检测 + 专属 prompt
├── prompts/<X>.md       # 每轮固定 prompt（loop 的"取数指令"）
├── state.json           # 水位/队列/配置（loop 的持久记忆，不依赖上一轮会话）
├── logs/                # 每轮 JSONL 输出（<轮名>-YYYY-MM-DD-HHMM.jsonl）
├── .lock                # flock 文件
└── systemd/<slug>[.followup].{service,timer}
```

通用红线写进 prompt：写操作按 Level 分层（L0 只允许 state 水位 / daily log / DM），报告先于水位提交。

## Timer 安装（per slug）

```bash
for u in <slug> [<slug>-followup]; do
  ln -sf "$(pwd)/loops/<slug>/systemd/$u.service" ~/.config/systemd/user/
  ln -sf "$(pwd)/loops/<slug>/systemd/$u.timer"  ~/.config/systemd/user/
  systemctl --user enable --now "$u.timer"
done
systemctl --user daemon-reload
```

service 的 `ExecStart` 指向 `%h/code/agents-config/loops/<slug>/<slug>.sh`（main checkout 路径）——worktree 里调试时手动 `bash loops/<slug>/<slug>.sh`，启用 timer 前先把改动合回 main。

## 新增一个循环

1. `cp -r intake/<new-slug>` 后重命名 sh/unit 文件里的 slug
2. 重写 `prompts/`，替换取数源头与红线（沿用"三处允许写 + Level 分层"格式）
3. 清空 `state.json`，按新源头定义初始水位
4. 安装 timer（见上），`systemctl --user list-timers` 确认
5. logs/ 与水位不跨循环共享——重命名后即隔离
6. 次轮（followup 型）的执行边界必须以“允许写清单”写入其 prompt 头（详见 intake/prompts/followup.md 的形制）

## 水位规则

- `state.json` 是唯一跨轮状态；写入用临时文件 + `mv` 原子替换
- 失败轮/超时轮不推进水位（下轮重扫同一窗口），但异常要写进当日 daily log
- 水位只增不减；源头重构（换频道/换列）时人工重置