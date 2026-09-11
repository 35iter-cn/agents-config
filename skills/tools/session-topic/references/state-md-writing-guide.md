# STATE.md, Numbering, and Artifact Removal

## Two owners

- **Frontmatter is CLI-owned.** `specs:` (spec + plan status) and `artifacts:` entries are added only via `artifact-create` / `plan-status` and removed only via `artifact-remove`. Never hand-edit registrations; never hand-delete a registered file.
- **The body is LLM-owned and actively maintained.** Keep a `# Session State` summary (spec progress, worktree status, artifacts) plus durable conclusions — decisions, milestones, architecture notes worth carrying across sessions. The CLI preserves the body when it rewrites STATE.md.
- `artifacts:` entries are `{ id, name, type, file }`, where `type` is `research | handoff | uat-case | notes` and `file` is the basename (e.g. `02-bar.research.md`).
- Update STATE.md in the same turn progress happens — spec finalized, milestone done, `plan-status` changed — not at session end.
- **Body revisions are committed in the same turn.** Material changes to the body land in the sessions git repo with a one-line commit message; the diff carries the detail. The sessions root is a git repo; worktrees are gitignored.

## Body writing rules (dashboard + index)

The body is a dashboard and an index — never a second spec. Knowledge lives in artifacts; STATE.md only points at it. These rules are gates, not defaults: user pressure does not waive them (same clause as the Enforcement Checkpoints in `SKILL.md`). Five zones:

**1. Status table** — one row per spec: `| Spec | Freeze | PR | Next |`. Freeze tracks the user-initiated freeze (`open` / `frozen`); Next holds the per-spec hint (together with Todos, the only places allowed to carry todo semantics).

**2. Worktree bullets** — unchanged, see `worktrees.md`.

**3. Pointers** — navigation only, zero information content: `investigation → see D-01`, `decision → spec 01 Decision record`, `ACs → spec 01 §4`. Delete the pointer when the target goes. `verify` warns on refs to nonexistent files/ids.

**4. Notes** — dated one-line conclusions with no artifact home yet (e.g. "2026-08-16 production data survey impossible, does not block M1"). Settled facts only; open questions are forbidden (`verify` warns on TBD/待定/待确认 — unsettled items get decided with the user, never written down). Grows past 3 lines or gets cited twice → promote to an artifact, leave a pointer.

**5. Todos** — topic-level action queue, hard cap 3, order = priority (adding item 4 means demoting one). Imperative, one line, actionable. Optional `⚡` prefix marks a low-hanging fruit the next session picks up first. Completed items are deleted in the same turn (git remembers).

### Knowledge placement

| Content | Home |
|---|---|
| Settled decisions | spec Decision record section |
| Investigation / analysis | research artifact |
| Edge conclusions | notes artifact (Notes zone before promotion) |
| Revision history | git commit + one-line STATE.md body summary |

### Slimming

The continue-flow STATE.md read is the health check: fix contradictions with reality, delete completed Todos, migrate over-long Notes to artifacts — all in the same turn. `verify` prints `warn:` lines for body refs to nonexistent files/ids, TBD wording, Todos > 3, plan AC refs unknown to the spec, and a dirty sessions git repo; treat every warn as the same-turn cleanup list.

## Numbering

- The spec/plan sequence and the `D-NN` document sequence increment independently and never borrow each other's numbers.
- Document numbers are never reused — a tombstone line still occupies its number.
- Legacy documents (bare `NN-` research/handoff/uat-case/notes) keep their original numbers; migrate them opportunistically, never force renames.
- Reference a document by its type or prefix ("spec 24", "D-01"), never a bare number.
- `verify` rejects unregistered files of any type and any unnumbered `.md` in the topic root. When STATE.md and the files disagree, trust the files and fix STATE.md.

## Merging and removing documents

1. `artifact-create` the target artifact (it allocates the next `D-NN`).
2. Merge the content in by hand — the CLI manages registration, not content.
3. `artifact-remove <topic> <id> --reason "merged into D-NN"` for each source; file and registration go together and a tombstone line lands in the body.
4. Update the body and any surviving documents that referenced the removed numbers.
5. `verify` must pass.

Specs/plans are removable via `artifact-remove <topic> <id> --type spec|plan` under hard gates: an implemented spec/plan is a complete implementation-chain record and **cannot** be deleted (follow-up goes through a new spec); deletion requires the user's explicit instruction (`--confirmed` plus a `--reason` recording it); a spec with a registered open plan needs the plan removed first. Ids colliding across the spec and artifact namespaces require `--type` — the CLI refuses to guess.

## PR references in the body

Outside a `worktree-<repo>` bullet use canonical `owner/repo#N`; a bare `#N` is acceptable inside a worktree bullet (the bullet scopes the repo). Never rewrite legacy body text to canonical form.
