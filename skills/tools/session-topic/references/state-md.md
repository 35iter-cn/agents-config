# STATE.md, Numbering, and Artifact Removal

## Two owners

- **Frontmatter is CLI-owned.** `specs:` (spec + plan status) and `artifacts:` entries are added only via `artifact-create` / `plan-status` and removed only via `artifact-remove`. Never hand-edit registrations; never hand-delete a registered file.
- **The body is LLM-owned and actively maintained.** Keep a `# Session State` summary (spec progress, worktree status, artifacts) plus durable conclusions — decisions, milestones, architecture notes worth carrying across sessions. The CLI preserves the body when it rewrites STATE.md.
- `artifacts:` entries are `{ id, name, type, file }`, where `type` is `research | handoff | uat-case | notes` and `file` is the basename (e.g. `02-bar.research.md`).
- Update STATE.md in the same turn progress happens — spec finalized, milestone done, `plan-status` changed — not at session end.

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
