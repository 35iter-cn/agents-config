# Locating Topics and Registering PRs

## find

To locate an existing topic from a PR link, branch, repo, date, or keyword, always run `find` — never recursive-grep `~/.config/sessions/` (it hits `worktree-*/` build artifacts and takes multiple passes).

```bash
node session-topic.mjs find "https://github.com/MagicDoorInc/magic-manager/pull/1"
node session-topic.mjs find "MagicDoorInc/magic-manager#1"
node session-topic.mjs find "refactor/chat-upload-sessions"
node session-topic.mjs find "chat multipart" --since 2026-08-20
```

- The CLI auto-classifies the query: PR URL / `owner/repo#N` / `short#N` / bare `#N` / branch (contains `/`) / keyword.
- `--repo`, `--since`, `--until` narrow results. Translate relative dates ("yesterday", "last week") into `YYYY-MM-DD` yourself — the CLI does not parse natural language.
- Matching layers, most reliable first: frontmatter `prs:` registry → canonical `owner/repo#N` refs in the body → full PR URLs → bare `PR #N` inside a `worktree-<repo>` bullet (repo inferred from the bullet) → loose keyword (candidates, marked `[unconfirmed]`).
- Bare `#N` collides across repos (backend #1 vs magic-manager #1): `find` lists all candidates and never guesses. Output is a ranked candidate list, never a verdict — read the top candidate's `STATE.md` to confirm before continuing work in it.
- Legacy topics are never backfilled; for them `find` relies on the body layers, by design.

## pr-add

When topic work produces a PR, register it **in the same turn** so future `find` queries hit the registry directly:

```bash
node session-topic.mjs pr-add <topic> <pr-url-or-owner/repo#N> [--branch <branch>]
```

- Frontmatter shape (CLI-owned): `prs:` array of `{ repo: full slug, number, branch? }`. The registry is an **index, not a mirror** — no status/title fields; those stay in the body narrative.
- Idempotent: re-registering an existing repo+number only updates `branch`.
