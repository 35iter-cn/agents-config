# Review Feedback Guide

How to turn review comments into something the next spec inherits, instead of a one-off fix.

Read this when a PR you handed off comes back — comments, `CHANGES_REQUESTED`, or a reviewer asking for a change — before fixing anything.

## Why this exists

A review comment is the most expensive signal a project produces: someone read the code against the project's own standards and wrote down where it diverged. Fixing only the code spends that signal once. Classifying it feeds it back, so the same class of comment cannot reach a reviewer twice.

The failure this prevents: a repo has written conventions, a spec never cited them, the reviewer catches fifty violations, the code gets fixed, and the next feature repeats the same fifty because nothing in the workflow recorded that the conventions exist and were skipped.

## Classify every comment

Each comment lands in exactly one of three buckets. Judge it by searching the repo's written conventions — never by whether the reviewer sounds senior.

| Bucket | Test | Action |
|---|---|---|
| **A. Written but not honoured** | The rule is in the repo's convention file(s), and the diff violates it | Fix the code, then check the spec's `§3.5 Conformance`: if the rule was listed, the failure is execution (the review gate skipped a `C-N`); if it was not listed, the failure is scoping (the clause was never cited) — say which one in the topic artifact |
| **B. Enforced but unwritten** | The reviewer requires it, and no convention file states it | Feed it back into the repo's convention file (or `docs/`), then reference it from the next spec's `§3.5`. This is the only bucket that makes the workflow better than it was |
| **C. In conflict** | The reviewer requires something the repo's written convention forbids, or two conventions disagree | Record the conflict in one line with both citations, ask the user to decide. Do not silently follow the reviewer, and do not silently follow the file |

A comment that is purely about this PR's own correctness (a bug in the branch, a wrong assertion) is none of these — fix it and move on; it carries no convention signal.

## Where the result goes

Record the classification in the topic, next to the spec (a `D-NN` notes artifact is enough): one row per comment class, its bucket, and where the rule now lives. The spec's `§3.5` is updated only when the spec is still `plan: open`; a frozen spec is history — the new clause goes into the next spec, never retro-fitted.

Never copy convention text into `STATE.md` or into a skill: the file in the repo stays the single source, and everything else points at it.

## When the repo will not take the clause

Some repos are read-only for the author, or the convention file is owned by another team. Then the clause lives in the topic artifact and is cited by absolute path in the next spec's `§3.5`, with one line saying why it is not in the repo. The point is that the next spec can see it, not that the file is edited.

## Anti-patterns

- **Treating the reviewer as the convention.** A reviewer's preference is bucket B at best; check the file before encoding it as a rule.
- **Fixing the code only.** The PR goes green and the next one repeats it — the cheapest half of the loop got done.
- **Rewriting a frozen spec.** Review feedback after freeze is a new spec or a follow-up artifact; the frozen record does not move.
- **Filing the class as "style".** Half of these comments are structural (where logic lives, what the model exposes, how tests are split) and carry the same weight as the code comments.
- **Bulk-applying one comment to every PR.** Each branch is a separate diff; a rule applied where it does not apply reads as noise and gets ignored.
