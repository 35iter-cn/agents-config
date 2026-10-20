---
name: magicdoor-backend-review
description: >
  Use for any review round on MagicDoorInc/backend (C#/.NET) — a PR you must
  review, or review comments you must answer: "zce 的评论", inline review,
  "review 一下这个 PR", CHANGES_REQUESTED, 收到 review 意见, 处理 review
  线程, 合并前自查, "你自己 review 了没有", or a review-driven fix round.
  Not for frontend portal PRs.
---

# MagicDoor Backend Review

A backend review round is a loop, not an opinion: **pull the comments → attribute
each one → verify the claim against the code → classify and dispose → fix →
verify → reply**. The same loop in reverse is the pre-push self-review.

Two sources of truth:

| Source | Role |
|---|---|
| `backend/.ai-knowledge/*.md` | Authoritative repo specs. Read the matching file before rewriting anything a comment touches. |
| `references/` here | Distilled review hot list — what reviewers actually flag, and what each flag traces back to. |

## When to use

- A PR on `MagicDoorInc/backend` needs review, or review comments arrived (inline
  or `CHANGES_REQUESTED`).
- A fix round is about to be pushed and needs the pre-push gate.
- Before asking a human to merge: the self-review pass.

Not here: frontend portal PRs, design/requirement review, merge mechanics
(`merge-pr`), rebase mechanics (`keep-branch-fresh`).

## Workflow

1. **Pull the comments.** Review bodies are usually empty on this repo; the
   content lives in line comments.

   ```bash
   gh api repos/MagicDoorInc/backend/pulls/<N>/comments \
     --jq '[.[]|{id,path,line,author:.user.login,body,in_reply_to}]'
   ```

   Also pull thread resolution state — resolved threads are done, not pending.

2. **Attribute every comment before answering any.** Run `gh pr diff <N>` and
   place each commented line in the `-`, `+`, or unchanged region.

   | Attribution | Tone and destination |
   |---|---|
   | Introduced by this PR | Fix it in this PR |
   | Pre-existing debt | Follow-up issue, or user's call to fix here |
   | Retracted (`nm, ignore this`) | No action; don't build on it |
   | Contested design / test shape | Decision goes to the user as A fix / B issue / C withdraw |

   Treating debt as your own work inflates the diff; treating your own work as
   debt loses quality. The classification is the review.

3. **Verify the claim against the codebase.** Reviewers here write telegraphically
   ("slop comments", "missing lock", "这种测试没什么意义"). Every claim so far
   was checkable — grep the util overload set, read the global exception filter,
   read the repository's `Get(ids)` implementation. Agree only after the check.
   When the reviewer's own example contradicts the goal (e.g. "pass the whole
   entity" vs "freeze one snapshot"), implement the intent and say why in the
   reply.

4. **Dispose each comment.** Pick one destination and record it: fixed in commit
   X / follow-up issue #N / withdrawn with the user's decision. A comment with
   no recorded destination is an unfinished round.

5. **Fix along the repo's grain.** Consult `references/repo-conventions.md` for
   the list reviewers enforce, then the matching `.ai-knowledge/` file for cases
   it doesn't cover. New code follows the convention; legacy debt in untouched
   code stays out of this PR.

6. **Rebase before pushing.** `keep-branch-fresh` (dry-run → rebase → verify),
   because master moves and the review fix must build on the tip.

7. **Verify** (`references/verification.md`): CI-parity build with 0 warnings,
   affected test filter green, `IDE0005` clean, `resync-slnx.sh` if a csproj
   moved. Rerun build + test *after* the rebase, not before.

8. **Reply and close the loop.** Reply on each thread with the commit hash, then
   request re-review formally — a fix comment without a reviewer request leaves
   `reviewDecision` at `REVIEW_REQUIRED` and the merge blocked:

   ```bash
   gh pr edit <N> --repo MagicDoorInc/backend --add-reviewer <login>
   gh pr view <N> --repo MagicDoorInc/backend \
     --json reviewRequests,reviewDecision,mergeStateStatus
   ```

   Resolve threads only after the code lands.

**Round is done when:** every comment has a recorded disposition, the diff shows
no unrelated files (`git status --porcelain`), build is 0 warnings, the affected
tests are green post-rebase, and threads carry replies with hashes.

## Pre-push self-review

Before handing off, answer these about your own last commit:

- Every deleted guard, fallback or null-check: can you state why it is now safe?
- Every new parallel task: which injected context makes it concurrency-safe?
- Every new assertion: does it lock a contract, or restate the implementation?
- Every degradation path: does it declare "data unavailable" instead of
  returning an empty collection that reads as zero?
- Any response shape change: which consumers did you grep, and where does the
  unwrap live?

## Quick Reference — the three flags reviewers hit most

- Comments that restate the code or narrate product intent → delete.
- New business exceptions → `MagicDoorException`, never raw `Exception`.
- List endpoints → bare `Task<TListDto>`, never `ActionResult<List<T>>` + `Ok()`.

## Common Mistakes

| Mistake | Reality |
|---|---|
| Answering comments before attributing them | You will fix debt in a feature PR and miss your own regression |
| Reading review state and concluding "no feedback" | Bodies are empty; the content is in line comments |
| Building on a retracted comment | Check for the follow-up "nm / ignore this" first |
| Asserting against the implementation's own constant | Validate the contract (`PayloadValidator.Validate`) instead |
| `Assert.All` over a collection that may be empty | Assert non-empty first, or the test passes vacuously |
| Deleting a null fallback on faith | Prove the lookup must hit: no Active filter, no soft-delete query filter, FK intact |
| Parallel `Fetch` on a scoped `DbContext` | Only `IDbContextFactory` (fresh context per call) permits concurrency |
| Pushing the fix without a formal re-review request | PR stays `REVIEW_REQUIRED` and blocked |
| Fixing 20 legacy exceptions/using in the feature PR | Note as debt, separate PR |

## References

| File | Use when |
|---|---|
| `references/repo-conventions.md` | Rewriting anything a comment touches — the convention list reviewers enforce |
| `references/correctness.md` | Judging behavior: regression vs restore, degradation honesty, concurrency, snapshot and lookup patterns |
| `references/testing.md` | Deciding which tests to keep, fix, or withdraw |
| `references/verification.md` | Commands for the build/test/using/slnx/rebase gate and the thread-close loop |

## Related

| Skill | Role |
|---|---|
| `keep-branch-fresh` | Rebase + force-with-lease before pushing a review fix |
| `merge-pr` | Squash merge once `reviewDecision` is APPROVED |
| `magicdoor-local-debug` | Verify a behavior change on a local stack |
