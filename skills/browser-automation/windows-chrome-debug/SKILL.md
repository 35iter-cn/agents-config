---
name: windows-chrome-debug
description: Start a Windows-side Chrome debug profile and expose its DevTools Protocol port to WSL for chrome-devtools MCP.
---

# Windows Chrome Debug 实例启动

在 WSL2 中运行 OpenCode 时，chrome-devtools MCP 无法直接启动 Windows Chrome。本 skill 用于在 Windows 侧启动一个独立的 Chrome 调试实例，并把它暴露给 WSL。

当前环境已启用 WSL 与 Windows 共享 localhost（如 mirrored 网络模式），WSL 可直接访问 Windows 侧的 `127.0.0.1`。

## Quick Reference

### 1. 启动 debug Chrome

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w /root/.claude/skills/windows-chrome-debug/start-debug-chrome.ps1)" -IconPath "$(wslpath -w /root/.claude/skills/windows-chrome-debug/debug-chrome.ico)"
```

脚本会：
- 使用独立 profile（`%LOCALAPPDATA%\DebugChrome`），避免和个人 Chrome 冲突
- 把调试服务绑定到 `127.0.0.1:9222`
- 以最小化窗口启动，不会突然弹出来
- 如果提供了 `-IconPath`，会把图标复制为 profile 的 `Google Profile.ico`，任务栏图标会显示为 DEBUG 图标
- 如果该端口已有 Chrome 运行，则直接复用，不会重复启动
- 优先查找 Chrome，找不到时回退到 Edge

### 2. 验证连通

```bash
curl -s http://127.0.0.1:9222/json/version
```

成功应返回包含 `Browser`、`Protocol-Version`、`webSocketDebuggerUrl` 的 JSON。

## 脚本说明

| 脚本 | 作用 |
| --- | --- |
| `start-debug-chrome.ps1` | 启动/复用独立 Chrome 调试实例，绑定 `127.0.0.1:9222` |

## MCP 配置

Claude Code 中的 chrome-devtools MCP 应指向本地端口：

```bash
claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest --browser-url=http://127.0.0.1:9222
```

## 注意事项

- 每次重启 Windows 后，需要重新执行启动脚本（Chrome 不会自启）。
- 如果你使用的是旧版 NAT 网络模式，WSL 无法直接访问 Windows `localhost`，需要恢复旧版流程（使用端口代理 `9222 -> 127.0.0.1:9222` 并通过 Windows IP 访问）。
