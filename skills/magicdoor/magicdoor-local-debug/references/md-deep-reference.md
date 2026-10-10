# md CLI deep reference

Deep reference for the `md` CLI itself: one-time setup, single-service IDE
debugging, addressing rules, and the full troubleshooting list. The daily
module workflow lives in `module-workflow.md` — this file is consulted when
something breaks or when a backend service itself must run under your
debugger.

**SOT:** `md --help` for flags; full guide is `README.md` in `$MD_CLI_SOURCE`
or `~/.magicdoor/src`. Never edit that directory — it is replaced on update.

## Setup (once)

Needs Docker with ≥8 GB allocated, `docker login registry.magicdoor.io`, and
`MAGICDOOR_DB_TEST_USER` / `MAGICDOOR_DB_TEST_PASS` in any
`~/.magicdoor/dev/env/*.env`.

```bash
command -v md >/dev/null || gh api repos/MagicDoorInc/magicdoor-cli/contents/install.sh \
    -H "Accept: application/vnd.github.raw" | bash
md doctor    # Docker, registry, hosts file, credentials — run this first
```

The repo is private, so `raw.githubusercontent.com` cannot serve it.

## Working on one backend service

```bash
md host leasing     # container → stub pointing here, plus a Stack profile
md unhost leasing   # hand it back to Docker
```

Run the `Stack` profile in the IDE; calls and Kafka events land in your
debugger. `md host` / `md unhost` are backend-only.

Frontends join the stack from their own checkout (`md link`, see
`module-workflow.md` Step 2).

## Addresses

`md urls` prints the real hostnames and ports — never invent them, or hand-set
DNS, `/etc/hosts`, mkcert or ports.

- `portal.<stack>.md.test`, `internal.<stack>.md.test`
- `<company>.with.<stack>.md.test`, with `/tenants` and `/owners` for
  tenant/owner portals
- `services.<stack>.md.test/<service>`

HTTPS is required, not cosmetic: login needs `crypto.subtle`. Stacks start
with company site `hogwarts`; `md add-website <company>` adds more.
Stack names come from the git branch at creation and are then fixed;
`--stack <name>` targets another; `md ls` lists, `md nuke <name>` destroys.

## Troubleshooting

- Anything odd: `md doctor`, then `md reset`.
- Service missing: unpullable images are skipped → `docker login`, `md up`.
- Containers dying or OOM: raise Docker memory, or `md up --only a,b,c`.
- Refuses to create a stack: OAuth redirect ports are pooled → `md nuke` an
  unused stack (`md ls`).
- Stack disagrees with reality: `md prune --apply`.
- Login fails with no obvious error: `mkcert -install`, then reload.
- Hosted service unreachable from the stack (502, stub logs socat
  "Connection refused" to `172.x.0.1`) while `curl localhost:<port>` works:
  the `Stack` profile binds `http://localhost:<port>` (loopback only) but the
  stub connects via `host.docker.internal`. Set
  `ASPNETCORE_URLS=http://*:<port>` inside the profile's
  `environmentVariables` (a profile value overrides the same variable on the
  command line). `md status` shows "listening" either way; check `ss -tln`
  for `*:port` vs `127.0.0.1:port`.
- Two hosted services started from the CLI at once collide in the shared
  `.artifacts/bin` output (MSB3248). Start them sequentially.
- Swagger is group-split: `GET /openapi/<Group>.json` (Maintenance:
  `Internal.json`; Portal: `InternalApp.json`); groups in
  `GET /swagger/index.js` (`urls` array).
- Minting an employee token for API testing without a browser:
  ① `POST https://auth.<stack>.md.test/internal/local-login` form
  `client_id=internal_portal&return_url=https://portal.<stack>.md.test/login/callback&state=x&email=<magicdoor email>`
  → 302; ② GET that redirect URL → its 302 carries `?code=…`;
  ③ `POST /oauth/token` form `grant_type=authorization_code&code=…&client_id=internal_portal`
  + same `redirect_uri` → `access_token` with `permissions: *`. Only works on
  stacks (LocalStackSignIn); use the `https://auth.<stack>.md.test` host
  consistently, never the localhost auth port from `md urls`.

## Red flags

- Editing `~/.magicdoor/src` — point `MD_CLI_SOURCE` at a clone instead.
- `md migrate` on a master checkout; or assuming `md up` needs the .NET SDK
  (only migrate does).
- `md host` on a frontend.
- An `md up` with no `--only` when the intent is a single module.