---
name: windows-config
description: Update Windows-side application configs from WSL, including Windows Terminal, WezTerm, VS Code, PowerShell profiles, etc. Use when user wants to modify Windows app settings, terminal configs, or shell profiles while working in WSL.
---

# Windows Config Updater

Edit Windows application configuration files from within the WSL environment.

## File Paths

### Windows Terminal

```
/mnt/c/Users/<username>/AppData/Local/Packages/Microsoft.WindowsTerminal_<suffix>/LocalState/settings.json
/mnt/c/Users/<username>/AppData/Local/Packages/Microsoft.WindowsTerminalPreview_<suffix>/LocalState/settings.json
```

Detect the active config by checking which file exists. The suffix (`8wekyb3d8bbwe`) is consistent.

### WezTerm

```
/mnt/c/Users/<username>/.wezterm.lua
/mnt/c/Users/<username>/.config/wezterm/wezterm.lua
```

### VS Code / VS Code Insiders

```
/mnt/c/Users/<username>/AppData/Roaming/Code/User/settings.json
/mnt/c/Users/<username>/AppData/Roaming/Code - Insiders/User/settings.json
```

### PowerShell Profile

```
/mnt/c/Users/<username>/Documents/PowerShell/Microsoft.PowerShell_profile.ps1
/mnt/c/Users/<username>/Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1
```

## Finding the Username

```bash
ls /mnt/c/Users/ | grep -v -E '^(Public|Default|All Users|desktop.ini)$' | head -1
```

Or use the most recently modified user profile directory.

## Guidelines

- **Always back up** before modifying: `cp file.json file.json.bak.$(date +%s)`
- **Use JSON-aware editing** (Edit tool) for `.json` configs; be careful with trailing commas
- **Use Lua-aware editing** for `.wezterm.lua`
- **Check file existence** before reading/writing; multiple install variants may exist
- **Line endings**: Windows files use CRLF. The Edit/Read tools handle this transparently
- **Permissions**: WSL has full access to `/mnt/c/`; no elevation needed for user-scoped configs
- **Admin operations**: For actions requiring elevation (e.g. `powercfg`, registry changes under `HKLM`, system-wide installs), trigger UAC via `Start-Process -Verb RunAs`. The user must approve the UAC prompt; the agent cannot bypass it. Have the elevated process write results to a file under `/mnt/c/` so WSL can read them back.

## Common Operations

### Windows Terminal

- Remove per-profile `colorScheme` overrides → use `profiles.defaults.colorScheme`
- Update font family/size in `profiles.defaults.font`
- Add/remove keybindings in the top-level `keybindings` array
- Change `defaultProfile` GUID

### WezTerm

- Update color scheme: `config.color_scheme = '...'`
- Update font: `config.font = wezterm.font('...')`
- Update key bindings in `config.keys`

### VS Code

- Update `settings.json` keys; many settings live under editor/workbench/terminal namespaces
