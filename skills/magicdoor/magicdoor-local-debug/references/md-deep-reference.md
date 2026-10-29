# md CLI deep reference

One-time setup, the address map, the full troubleshooting list, and the red
flags. Day-to-day workflow is `SKILL.md`; frontend detail is
`module-workflow.md`.

**SOT:** `md --help` for flags; the full guide is `README.md` in
`$MD_CLI_SOURCE` or `~/.magicdoor/src`. Never edit that directory — it is
replaced on update.

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

## Addresses

`md urls` prints the real hostnames and ports — never invent them, or hand-set
DNS, `/etc/hosts`, mkcert or ports.

- `portal.hao-local-debug.md.test`, `internal.hao-local-debug.md.test`
- `<company>.with.hao-local-debug.md.test`, with `/tenants` and `/owners` for the
  tenant and owner portals
- `services.hao-local-debug.md.test/<service>`

HTTPS is required, not cosmetic: login needs `crypto.subtle`. A stack starts with
the company site `hogwarts`; `md add-website <company>` adds more. `md ls` lists
stacks, `md down` stops one keeping its databases, `md nuke <name>` destroys one.

## Troubleshooting

- Anything odd: `md doctor`, then `md reset`.
- Service missing: unpullable images are skipped → `docker login`, `md up`.
- Containers dying or OOM: raise Docker memory, or `md up --only a,b,c`.
- Refuses to run: OAuth redirect ports are pooled → `md nuke` a leftover stack
  from before the single-stack convention (`md ls`).
- A service fails on a missing column or table: the reused database is behind the
  code → `md migrate --stack hao-local-debug` from the checkout carrying that
  migration. Still broken → `md reset --data`.
- Stack disagrees with reality: `md prune --apply`.
- Login fails with no obvious error: `mkcert -install`, then reload.
- An endpoint 404s that your backend branch adds: expected — the container runs a
  master image. Take the service over with `md host`, do not build an image.
- Hosted service unreachable from the stack: the `Stack` profile binds
  `http://localhost:<port>` (loopback only), so anything calling the service from
  inside the stack fails — sometimes as a 502 or `Connection refused` in the stub
  log, sometimes as `HttpIOException: The response ended prematurely` in the
  caller, which cascades into a 422 on an unrelated endpoint (a login page that
  drops back to `/login` is the usual disguise). Check immediately after
  `md host`:

  ```bash
  ss -tlnp | grep :<port>     # want *:<port>; 127.0.0.1:<port> is the bug
  ```

  Fix by starting the service on all interfaces:

  ```bash
  dotnet run --project Apps/<Service>/<Service>.App --launch-profile Stack \
      --urls http://0.0.0.0:<port>
  ```

  If `--urls` does not take (a profile value overrides the same variable on the
  command line), set `ASPNETCORE_URLS=http://*:<port>` inside the profile's
  `environmentVariables` instead. `md status` reports "listening" either way —
  only `ss -tln` distinguishes them. Finish with `md unhost <service>`; leaving a
  service hosted breaks every in-stack S2S call to it.
- Two hosted services started from the CLI at once collide in the shared
  `.artifacts/bin` output (MSB3248). Start them sequentially.
- Swagger is group-split: `GET /openapi/<Group>.json` (Maintenance:
  `Internal.json`; Portal: `InternalApp.json`); groups in `GET /swagger/index.js`
  (`urls` array).
- Minting an employee token for API testing without a browser:
  ① `POST https://auth.hao-local-debug.md.test/internal/local-login` form
  `client_id=internal_portal&return_url=https://portal.hao-local-debug.md.test/login/callback&state=x&email=<magicdoor email>`
  → 302; ② GET that redirect URL → its 302 carries `?code=…`; ③ `POST
  /oauth/token` form
  `grant_type=authorization_code&code=…&client_id=internal_portal` + the same
  `redirect_uri` → `access_token` with `permissions: *`. Stacks only
  (LocalStackSignIn); use the `https://auth.hao-local-debug.md.test` host
  consistently, never the localhost auth port from `md urls`.

## Red flags

- Editing `~/.magicdoor/src` — point `MD_CLI_SOURCE` at a clone instead.
- Any `md` command without `--stack hao-local-debug` — it creates or adopts a
  branch-named stack instead, and the next `md up` re-pulls images and re-restores
  databases.
- `md nuke hao-local-debug` as cleanup; `md down` is the way to end a session.
- `md migrate` from a checkout that does not carry the migration (it applies that
  checkout's EF projects, nothing else); or assuming `md up` needs the .NET SDK
  (only migrate does).
- Building an image to get branch code into the stack, or swapping one in with
  `compose.override.yml` — `md host` is the axis for that.
- `md host` on a frontend.
- An `md up` with no `--only` when the intent is one module.
