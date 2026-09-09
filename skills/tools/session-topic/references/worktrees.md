# Worktrees

Topic code changes happen ONLY inside the topic worktree. The main checkout is never modified for topic work.

## Invariants

- **Path source is authoritative.** The path MUST come from `node session-topic.mjs worktree-path <topic>` — a hand-picked path (project sibling, `/tmp`, anything) is a violation even if it looks reasonable.
- **At most one worktree per repo per topic.** A topic may accumulate several PRs in one repo, never several live worktrees.
- Starting a new independent spec in a repo whose worktree holds a parked (unmerged) PR is a **replace, not a branch switch**. Never `git checkout` a different branch inside an existing worktree.

## Replace flow

1. **Preflight (read-only, no git mutations):**
   ```bash
   node session-topic.mjs worktree-check <topic> --repo <path-to-main-checkout>
   ```
   MUST exit 0: worktree absent, or present and clean. FAIL = stop, resolve, re-run. The report also covers push state, PR registration in STATE.md `prs:`, and an origin baseline snapshot — treat every FAIL item as a blocker.
2. **Retire:**
   ```bash
   git worktree remove <worktree-path>
   ```
   Keep the local branch — it is the parked PR's recovery anchor.
3. **Create** (path from `worktree-path`, based on latest `origin/<default>`; run `gco-latest` on the main checkout first so the branch is not cut from stale code):
   ```bash
   git worktree add "<worktree-path>" -b <branch> <base>
   ```
   Never reuse a branch already registered in STATE.md `prs:` for that repo, and never base a new spec's branch on another spec's PR branch.
4. **Write gate:**
   ```bash
   node session-topic.mjs guard <topic>
   ```
   Must return `ok` before the first write; re-run on every write-critical action — the shell cwd drifts across a long session.

## guard blind spot

`guard` validates location, not branch. An `ok` inside a worktree whose branch belongs to another spec's parked PR is a false pass. Branch correctness comes from the worktree-check report and the branch↔spec records in the STATE.md body.

## After retiring

Keep the frontmatter `prs:` entry and update the STATE.md body bullet (branch, HEAD, PR number, parked/merged status) — the body is the only durable map of parked branches.

A topic may span multiple repositories, but each repository has at most one worktree within a topic.
