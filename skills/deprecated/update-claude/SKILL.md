---
name: update-claude
description: Update Claude Code CLI on networks with intermittent connectivity. Use when user says "update claude", "upgrade claude", "claude update failed", or when claude update/download fails due to unstable network.
---

# Update Claude

Update Claude Code CLI when `claude update` fails due to unstable network connections.

## Problem

On some networks (especially in regions with poor connectivity to Anthropic's CDN), `claude update` and `curl | bash` fail with:

```
Error: The socket connection was closed unexpectedly
curl: (18) Transferred a partial file
```

## Solution

Use the bundled script with `wget` resume download, checksum verification, and manual installation.

### Quick update

```bash
bash skills/update-claude/scripts/update-claude.sh
```

### Options

```bash
# Dry run — see what would happen without changing anything
bash skills/update-claude/scripts/update-claude.sh --dry-run

# Update to a specific version
bash skills/update-claude/scripts/update-claude.sh 2.1.173
```

## What the script does

1. **Detects platform** — auto-detects OS, architecture, and musl libc
2. **Resolves version** — fetches latest version or uses user-specified one
3. **Resumes download** — uses `wget -c` with 10 retries; survives connection drops
4. **Verifies integrity** — SHA-256 checksum from official manifest
5. **Installs manually** — bypasses `claude install`'s network requests by directly replacing the binary and symlink

## Manual fallback

If the script is unavailable, run the equivalent steps manually:

```bash
version=$(wget -qO- https://downloads.claude.ai/claude-code-releases/latest)
platform="linux-x64"  # adjust for your OS/arch

wget --tries=10 --retry-connrefused --timeout=60 -c \
  -O ~/.claude/downloads/claude-$version-$platform \
  https://downloads.claude.ai/claude-code-releases/$version/$platform/claude

cp ~/.claude/downloads/claude-$version-$platform ~/.local/share/claude/versions/$version
chmod +x ~/.local/share/claude/versions/$version
ln -sf ~/.local/share/claude/versions/$version ~/.local/bin/claude
```

## When not to use

- If `claude update` works normally — use the official command
- If installed via Homebrew (`brew install --cask claude-code`) — use `brew upgrade` instead
- If installed via npm (`npm install -g @anthropic-ai/claude-code`) — use `npm update -g`
