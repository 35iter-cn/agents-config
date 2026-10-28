---
name: magicdoor-repo-review
description: >
  Self-review a MagicDoor pull request right after opening it — check the diff
  against the repo's own convention documents and against the review experience
  recorded in the AI-taught-me knowledge base, fix the smells this PR
  introduced, and escalate to the user whenever those two sources disagree.
  Triggers: "review 一下这个 PR", 自查, "你自己 review 了没有", PR 刚建好要过一遍,
  合并前复核, or a review-driven fix round on a MagicDoor repo (backend, portals,
  frontend-common-module, cms, bff).
---

# MagicDoor Repo Review

One review round per PR: **collect both sources → review the diff → classify →
fix → verify → report**. Runs right after `gh pr create`, and again before a
merge or a re-review request.

## Two sources, nothing else

| Source | Where it lives | Role |
|---|---|---|
| The repo's own conventions | `backend`: `AGENTS.md` + `.ai-knowledge/INDEX.md` and the guides it routes to. Frontend repos: `AGENTS.md` (or `CLAUDE.md`) + `.knowledge/docs/`. | Written law. Always wins over experience. |
| Recorded review experience | `~/code/AI-taught-me/code-review/` — one directory, one topic per report, frontend and backend side by side. For backend start with `backend-code-review-playbook/`; otherwise `ls` the directory and pick the entry whose subject matches this PR. | Fills the gaps the written docs leave, and records what reviewers actually flag. |

Do not add a third source. Stack Overflow, a blog, a memory of another repo, or
your own taste is not a rule. The code is **evidence of what is**, never evidence
of what should be — cite it to prove a claim, not to invent a rule.

When both sources are silent on a real problem in the diff, say so in the report
and let the user decide; do not quietly promote your preference to a rule.

## Conflict rule — escalate, never pick

When the two sources disagree, or an experience entry contradicts the current
code or a doc that has since moved on, **stop and tell the user**:

- quote both sides (file:section + the KB entry path, or the two contradicting sentences)
- state the concrete impact: which lines of this diff change under each reading
- ask which wins, and offer to write the outcome back into the losing side

Never silently apply the stricter reading. Same when an experience entry is
stricter than the repo's docs but the repo's own code broadly ignores it — that
is a convention-versus-debt question, not a review finding.

## Workflow

1. **Locate the repo and its law.** `git rev-parse --show-toplevel`, then read the
   convention entry file(s) for that repo. Read the sections the diff touches, not
   the whole tree.
2. **Pull the experience.** `ls ~/code/AI-taught-me/code-review` — one directory, one topic per report, no
   backend/frontend nesting. Read the entries whose subject matches this PR
   (`cheat-sheet.md` first, `report.md` when a rule needs its why). Load the
   `ai-taught-me` skill for its query workflow.
3. **Build a checklist before reading the diff.** One line per rule, tagged
   `conv` (repo doc, with `file:section`) or `kb` (experience, with the entry path).
   A rule that cannot name its source does not enter the checklist.
4. **Review the diff, not the repo.** Attribute every finding: introduced by this
   PR (fix it here) or pre-existing debt (report it, or open a follow-up — never
   inflate this diff with it).
5. **Fix along the grain.** New code follows the convention even when neighbouring
   legacy code does not; leave legacy in untouched code alone.
6. **Verify**, then push, then re-check the PR state:
   - backend: `ContinuousIntegrationBuild=true dotnet build <Service>.slnx --nologo -v q`
     (0 warnings), `dotnet format --diagnostics IDE0005 … --verify-no-changes`,
     `dotnet test <tests.csproj> --filter "FullyQualifiedName~<Class>"`.
     Rebase before verifying, not after.
   - frontend: `pnpm type-check`, `pnpm lint` (no new warnings), `pnpm test`;
     `pnpm swagger`-style regeneration only if the API types moved.
7. **Report** in the chat, not in the PR: findings table (finding / source
   `conv:file:section` or `kb:entry` / attribution / disposition), the conflicts
   section, and what was deliberately left out with the reason.

## Judgement rules that survive every repo

- A new assertion must guard a real behaviour or an external contract. If you
  cannot state it in one sentence without the words "calls", "returns" or "does
  not call", it is an implementation echo — delete it. See
  `backend-code-review-playbook` §11 in that directory for the full retention rule.
- Comments explain only a non-obvious *why*. A summary that restates the member
  name gets deleted.
- A growing diff of new tests is a finding, not thoroughness.
- Every deleted guard, fallback or null-check needs a sentence saying why it is
  safe now.
- A response-shape change needs the list of consumers you grepped.

## Reporting contract

- Never claim a review round is done without naming, per finding, its source and
  its disposition (fixed in commit X / follow-up issue / escalated).
- A conflict that was resolved by the user's ruling is also reported as done work.
- If a fix changes behaviour, say what to re-run; if nothing was verifiable
  locally, say which gap stayed open.

## Not here

Design or requirement review, merge mechanics (`merge-pr`), rebase mechanics
(`keep-branch-fresh`), local-stack trouble (`magicdoor-local-debug`).
