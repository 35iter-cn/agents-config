---
name: windows-chrome-debug
description: Start a Windows-side Chrome debug profile and expose its DevTools Protocol port to WSL for chrome-devtools MCP.
---

# Windows Chrome Debug 实例启动

在 WSL2 中运行 OpenCode 时，chrome-devtools MCP 无法直接启动 Windows Chrome。本 skill 用于在 Windows 侧启动一个独立的 Chrome 调试实例，并把它暴露给 WSL。

## Quick Reference

### 1. 获取 Windows 主机 IP

从 WSL 运行本 skill 目录下的 `get-windows-ip.ps1`：

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w /root/.claude/skills/windows-chrome-debug/get-windows-ip.ps1)"
```

记下返回的 IP，例如 `192.168.3.110`。

### 2. 启动 debug Chrome

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w /root/.claude/skills/windows-chrome-debug/start-debug-chrome.ps1)" -IconPath "$(wslpath -w /root/.claude/skills/windows-chrome-debug/debug-chrome.ico)"
```

脚本会：
- 使用独立 profile（`C:\temp\chrome-debug-profile`），避免和个人 Chrome 冲突
- 把调试服务绑定到 `127.0.0.1:9221`
- 以最小化窗口启动，不会突然弹出来
- 如果提供了 `-IconPath`，会把图标复制为 profile 的 `Google Profile.ico`，任务栏图标会显示为 DEBUG 图标
- 如果该端口已有 Chrome 运行，则直接复用，不会重复启动

### 3. 配置端口代理

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','$(wslpath -w /root/.claude/skills/windows-chrome-debug/set-portproxy.ps1)' -Verb runAs -Wait"
```

这会建立 `0.0.0.0:9222 -> 127.0.0.1:9221` 的 v4tov4 端口代理，让 WSL 可以通过 Windows IP 访问。

### 4. 验证连通

```bash
curl -s http://192.168.3.110:9222/json/version
```

成功应返回包含 `Browser`、`Protocol-Version`、`webSocketDebuggerUrl` 的 JSON。

## 脚本说明

| 脚本 | 作用 |
| --- | --- |
| `get-windows-ip.ps1` | 取 Windows 默认路由接口的主 IPv4 地址 |
| `start-debug-chrome.ps1` | 启动/复用独立 Chrome 调试实例，绑定 `127.0.0.1:9221` |
| `set-portproxy.ps1` | 配置 `0.0.0.0:9222 -> 127.0.0.1:9221` 端口代理（需管理员权限） |

## 为什么用 9221 + 9222？

新版 Chrome 会尝试绑定 `127.0.0.1` 作为调试地址。如果直接用 `9222` 并且端口代理也占用了 `0.0.0.0:9222`，Chrome 可能因端口冲突 fallback 到 IPv6 `::1`，导致 v4tov4 代理失效。

把 Chrome 调试端口设成 `9221`，再用端口代理把外部 `9222` 映射到 `9221`，可以避免这个冲突，稳定使用 IPv4 转发。

## 注意事项

- 每次重启 Windows 后，需要重新执行步骤 2 和 3（Chrome 不会自启，但 portproxy 配置会持久化；这里选择每次启动时重新配置，避免旧规则干扰）。
- `set-portproxy.ps1` 需要管理员权限，脚本已通过 `-Verb runAs` 触发 UAC。
- 如果 WSL 仍无法连通，先确认 Windows 防火墙放行入站 TCP 9222。
