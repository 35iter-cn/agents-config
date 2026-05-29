# Canonical skills tree

This directory is the **single source of truth** for Claude Code skill sources on this machine (see spec `~/.knowledge/notes/specs/2026-05-14-skills-canonical-dir-and-claude-sync-design.md`).

## Sync script

**Path:** `$HOME/agents-for-myself/bin/sync-skills` (on this host: `/root/agents-for-myself/bin/sync-skills`).

**Usage:**

```bash
# Defaults: SRC=$HOME/agents-for-myself/skills, targets read from bin/skills-symlinks.targets
sync-skills [--dry-run]

# Explicit source path (targets still from config file)
sync-skills -s /path/to/skills [--dry-run]
```

**Environment variables (override defaults):**

| Variable | Meaning |
|----------|---------|
| `SKILLS_CANONICAL_ROOT` | Canonical scan root (same as `-s`) |
| `SKILLS_SYMLINKS_TARGETS` | Override targets file path |

**Rules:** Only leaf directories containing `SKILL.md` are linked; category folders (no `SKILL.md` at that level) expose only their direct children. Duplicate link names exit with code 3. Existing non-symlink entries at a managed name exit with code 4. Unrelated names under target directories are never removed.

## Sandbox test (before first production run)

```bash
rm -rf /tmp/skills-sync-test-src /tmp/skills-sync-test-claude
mkdir -p /tmp/skills-sync-test-src/alpha
echo '# test' > /tmp/skills-sync-test-src/alpha/SKILL.md
mkdir -p /tmp/skills-sync-test-src/cat-beta/gamma /tmp/skills-sync-test-src/cat-beta/delta
echo '# g' > /tmp/skills-sync-test-src/cat-beta/gamma/SKILL.md
echo '# d' > /tmp/skills-sync-test-src/cat-beta/delta/SKILL.md
"$HOME/agents-for-myself/bin/sync-skills" -s /tmp/skills-sync-test-src --dry-run
"$HOME/agents-for-myself/bin/sync-skills" -s /tmp/skills-sync-test-src
# Expect: DST/alpha, DST/gamma, DST/delta are symlinks to SRC paths; second run is idempotent.
# Negative (duplicate basename gamma): add /tmp/skills-sync-test-src/other/gamma/SKILL.md and re-run; expect exit 3.
```

## Backup `~/.agents/skills` (recommended before first real sync)

```bash
mkdir -p "$HOME/agents-for-myself/backups"
ts="$(date +%Y%m%d-%H%M%S)"
tar -czf "$HOME/agents-for-myself/backups/agents-skills-${ts}.tar.gz" -C "$HOME" .agents/skills
tar -tzf "$HOME/agents-for-myself/backups/agents-skills-${ts}.tar.gz" | head
```

Restore: extract the tarball so paths line up under `$HOME` (e.g. `tar -xzf ... -C "$HOME"`).

## Optional cleanup

Deleting or emptying `~/.agents/skills` is **out of scope** for the default pipeline. Do it only after explicit dependency checks (e.g. no configs still reference `~/.agents/skills`) and if you choose to enable that step manually.
