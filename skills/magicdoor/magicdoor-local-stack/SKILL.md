---
name: magicdoor-local-stack
description: >
  Run and debug the MagicDoor backend and frontends locally with the `md` CLI
  (local development stacks). Use when asked to run the backend on this machine,
  start a stack, debug a backend service with IDE breakpoints, run a frontend
  against a local backend, or when `md up` / `md doctor` / `md host` misbehaves.
  Triggers: "本地起后端", "起一套 stack", "本地调试 leasing", "md up 失败".
---

# MagicDoor Local Stack (`md`)

`md` runs the whole MagicDoor system locally; a **stack** is one complete copy with its own
databases, Kafka topics and hostnames. It runs published images for everything — you take over only
the services you are changing, and those run in your IDE with breakpoints while the rest of the
stack keeps calling into them.

**SOT:** `md --help` for flags; full guide is `README.md` in `$MD_CLI_SOURCE` or `~/.magicdoor/src`.
Never edit that directory — it is replaced on update.

## Setup (once)

Needs Docker with ≥8 GB allocated, `docker login registry.magicdoor.io`, and
`MAGICDOOR_DB_TEST_USER` / `MAGICDOOR_DB_TEST_PASS` in any `~/.magicdoor/dev/env/*.env`.

```bash
command -v md >/dev/null || gh api repos/MagicDoorInc/magicdoor-cli/contents/install.sh \
    -H "Accept: application/vnd.github.raw" | bash
md doctor    # Docker, registry, hosts file, credentials — run this first
```

The repo is private, so `raw.githubusercontent.com` cannot serve it.

## Everyday

```bash
md up                  # first run pulls images + restores DBs from staging (slow)
md status / md urls    # what runs; every real address
md down                # stop, keep data
```

Stacks arrive at master's schema with staging data, so `md up` needs no migration; on a branch that
adds them, `md migrate --only <service>`.

## Working on one service

```bash
md host leasing     # container → stub pointing here, plus a `Stack` profile in launchSettings.json
md unhost leasing   # hand it back to Docker
```

Run the `Stack` profile in the IDE; calls and Kafka events then land in your debugger.

Frontends are containers too — from your own checkout:

```bash
md run      # link, write .env.local, start the dev server
md unlink   # from the checkout, or `md unlink <name>` from anywhere
```

`md host` / `md unhost` are backend-only.

## Addresses

`md urls` prints the real hostnames and ports — never invent them, or hand-set DNS, `/etc/hosts`,
mkcert or ports.

- `portal.<stack>.md.test`, `internal.<stack>.md.test`
- `<company>.with.<stack>.md.test`, with `/tenants` and `/owners` for tenant/owner portals
- `services.<stack>.md.test/<service>`

HTTPS is required, not cosmetic: login needs `crypto.subtle`. Stacks start with company site
`hogwarts`; `md add-website <company>` adds more.

Stack names come from the git branch at creation and are then fixed — switching branches neither
renames it nor starts a second one. `--stack <name>` targets another; if its worktree is gone,
`md ls` still lists it and `md nuke <name>` destroys it.

## Troubleshooting

- Anything odd: `md doctor`, then `md reset`.
- Service missing from the stack: unpullable images are skipped, not fatal → `docker login`, `md up`.
- Containers dying or OOM: raise Docker memory, or `md up --only a,b,c`.
- Refuses to create a stack: OAuth redirect ports are pooled → `md nuke` an unused stack (`md ls`).
- Stack disagrees with reality, e.g. containers removed by hand: `md prune --apply`.
- Login fails with no obvious error: `mkcert -install`, then reload.

## Red flags

- Editing `~/.magicdoor/src` — point `MD_CLI_SOURCE` at a clone instead.
- `md migrate` on a master checkout; or assuming `md up` needs the .NET SDK (only migrate does).
- `md host` on a frontend.
