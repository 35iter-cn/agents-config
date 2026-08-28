---
description: |
  Orchestrate the implementation pipeline from a ready design spec: delegate review to cursor, fix high-confidence issues, delegate implementation to opencode, auto-commit, and hand off the PR.
---

## Overview

A combo skill that bridges the gap between a ready design spec and working code through six phases: validate, review (cursor), refine, implement (opencode), commit, and PR handoff.

## When to Use

- User has a design spec ready and wants to "ship it"
- User wants a structured path from spec to implementation
- User wants peer review on the design before coding

## When NOT to Use

- No design spec exists yet — use `brainstorming` first
- User only wants a quick one-off edit
- User explicitly wants to skip the design/review phase

## Workflow

### Phase 1: Validate Spec

Extract the spec file path from session context, verify it exists. If not found, pause and report.

### Phase 2: Delegate Review to Cursor

**Required sub-skill:** `runx` (companion=`cursor`).

Assemble a prompt that includes:
- Spec file path
- Original requirements from session context
- Relevant codebase background (frameworks, conventions, related files)

Ask cursor to evaluate: security, performance, maintainability, edge cases, architecture fit. **Require confidence ratings** (high / medium / low) for all findings.

### Phase 3: Refine Design

Evaluate cursor's findings against session context, original intent, and codebase conventions.

- **High-confidence issues:** Revise the spec, update the file
- **No high-confidence issues:** Proceed with original spec

**One round only.** Do not loop back for additional review.

### Phase 4: Delegate Implementation to Opencode

**Required sub-skill:** `runx` (companion=`opencode`).

Prompt:

```
implement specs <spec-path>
```

Where `<spec-path>` is the (possibly revised) spec file.

### Phase 5: Auto Commit

Check working tree status. If clean, skip to Phase 6.

If changes exist, generate a semantic commit message from `git diff` and run `git add -A && git commit -m "<message>"`.

### Phase 6: Delegate PR Handoff

**Required sub-skill:** `pr-handoff`. Load and follow it directly to push the branch and create/update the PR.

## Common Mistakes

- Passing spec content inline instead of the file path — always pass the path
- Skipping secondary evaluation and blindly applying all cursor suggestions
- Not including codebase context in the review prompt
- Looping for multiple review rounds (one round max)
- Committing without checking working tree status first
- Skipping PR handoff because "it's just a small change"
- Failing to verify the spec path exists before delegating to cursor

## Red Flags

- Cursor review has no confidence ratings — prompt was malformed, stop and fix
- User interrupts mid-flow with new requirements — stop, clarify, restart if needed
- Working tree has changes but commit was skipped — pipeline is incomplete
- PR handoff fails silently — always surface the error and wait for decision
