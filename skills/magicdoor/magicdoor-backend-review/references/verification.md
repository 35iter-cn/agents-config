# Verification gate

Run in this order: rebase → build → format/using → tests → slnx → push → reply.
Verifying before the rebase verifies a tree nobody will merge.

## Build with CI parity

```bash
ContinuousIntegrationBuild=true dotnet build <Service>.slnx --nologo -v q
```

Target one service `slnx` during iteration (fast); the full `MagicDoor.All.slnx`
only when a project file or solution changed.

The repo has **no** IDE0005 / format gate in CI (`EnforceCodeStyleInBuild` is
commented out in `Directory.Build.props`), so an unused using compiles clean.
Clean it explicitly:

```bash
dotnet format <csproj> --diagnostics IDE0005 --severity info \
  --include <changed files> --verify-no-changes
```

The analyzer catches what eyes miss on a thousand-line controller.

## Unused using, when the formatter is not enough

Per-using adjudication, one at a time (incremental build, `git checkout -q --
<file>` between rounds):

```bash
awk -v n=$i '/^using /{c++; if(c==n) next} {print}' f.cs > f.tmp && mv f.tmp f.cs
dotnet build <proj.csproj> 2>&1 | grep -E "error CS"   # all CS codes, not just CS0246
```

Zero errors → REDUNDANT; any `CS` → needed (CS0103 for statics/enums, CS1061 for
extension methods). Check the repo has no global using / `<Using Include>`
fallback first, then rebuild both service and full `slnx`.

Build can rewrite the `csproj` of an SDK-glob project — a pure-deletion PR showing
a `csproj` hunk is build pollution:

```bash
git checkout <pr-base> -- <file.csproj>
git status --porcelain
```

## Tests

```bash
dotnet test <tests.csproj> --filter "FullyQualifiedName~<ClassOrNamespace>"
```

Filter to the affected set for the round; run the owning domain project once
before the final push.

## Solution file

After adding a project, rebasing onto a `slnx` conflict, or pulling in a new
csproj:

```bash
./Scripts/resync-slnx.sh
```

Never hand-edit `MagicDoor.All.slnx`.

## Contract spot checks

Swagger (query stays flat after a filter DTO refactor):

```bash
curl -sk http://localhost:<port>/openapi/<Group>.json | python3 -m json.tool
```

Behavior on a real stack: use `magicdoor-local-debug`, and confirm which checkout
the dev server actually serves before trusting a UI result — a busy port makes
Vite silently move to the next one and serve someone else's code.

## Push, request re-review, resolve threads

```bash
git push --force-with-lease=<branch>:<old-sha>
gh pr edit <N> --repo MagicDoorInc/backend --add-reviewer <login>
gh pr view <N> --repo MagicDoorInc/backend --json reviewRequests,reviewDecision,mergeStateStatus
gh api repos/MagicDoorInc/backend/pulls/<N>/comments \
  --jq '[.[]|{id,path,line,author:.user.login,body,in_reply_to}]'
```

A reply without a formal review request leaves `reviewDecision` at
`REVIEW_REQUIRED` and the PR blocked. Reply with the commit hash, then resolve
the thread once the code is on the branch.

## Recovery

```bash
git revert <sha>                          # single review-fix commit
git revert -m 0 <merge-commit>            # squash-merged PR (single parent)
git show <pr-base>:<path> > <path>        # withdraw one file's changes
git restore <path>                        # undo an experiment
```
