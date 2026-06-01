---
name: ship-it
description: |
  Orchestrate the full design-to-implementation pipeline: generate a design spec via brainstorming, have cursor review it, fix high-confidence issues, then delegate implementation to opencode.
  Use when the user has clarified requirements and says "ship it" or wants to move from discussion to working code through a structured design-review-build workflow.
category: workflow
date_added: "2026-06-01"
---

## Overview

A combo skill that bridges the gap between requirement discussion and working code by chaining four phases: design (brainstorming), review (cursor), refinement (agent re-evaluation), and implementation (opencode).

## When to Use

- User says "ship it" after requirements have been clarified
- User wants a structured path from discussion to implementation
- User wants peer review on the design before coding starts
- Requirements are clear enough to generate a design spec

## When NOT to Use

- Requirements are still vague or exploratory
- User only wants a quick one-off edit
- The project has no established conventions or codebase context
- User explicitly wants to skip the design/review phase

## Quick Reference

### Phase 1: Generate Design Spec

**REQUIRED SUB-SKILL:** `brainstorming`. Generate a design spec from the current session context. Capture:
- Problem statement and goals
- Proposed solution and architecture
- Key decisions and trade-offs
- Files and components to create or modify

Save the spec to `.knowledge/docs/specs/` with a descriptive filename. Note the filepath.

### Phase 2: Delegate Review to Cursor

**REQUIRED SUB-SKILL:** `runx`. Delegate the design review to cursor.

**Prompt assembly:**
- Include the spec file path
- Include original requirements from session context
- Include relevant codebase background (frameworks, conventions, related files)
- Ask cursor to evaluate: security, performance, maintainability, edge cases, architecture fit
- **Mandatory output format:** Categorize findings by `confidence` (high / medium / low)

**Execution:** Use runx with agent=`cursor`, model tier inferred from spec complexity.

**On failure:** Pause, report error to user, wait for decision.

### Phase 3: Refine Design

Receive cursor's review. Evaluate each finding against:
- Session context and original intent
- Actual codebase state and conventions
- Technical feasibility

**Action rules:**
- If high-confidence issues exist: revise the spec, update the file
- If no high-confidence issues: proceed with original spec

**One round only.** Do not loop back for additional review.

### Phase 4: Delegate Implementation to Opencode

**REQUIRED SUB-SKILL:** `runx`. Delegate implementation to opencode.

**Prompt:**
```
implement specs <spec-path>
```

Where `<spec-path>` is the (possibly revised) spec file from Phase 1/3.

**Execution:** Use runx with agent=`opencode`, model tier inferred from implementation scope.

**On failure:** Pause, report error to user, wait for decision.

## Core Flow

```mermaid
flowchart TD
    A([User says "ship it"]) --> B[Phase 1: Brainstorming → Design Spec]
    B --> C[Phase 2: Runx → Cursor Review]
    C --> D{High-confidence issues?}
    D -->|Yes| E[Revise Spec]
    D -->|No| F[Keep Original Spec]
    E --> F
    F --> G[Phase 4: Runx → Opencode Implement]
    G --> H([Done])
    
    C -.->|Failure| I[Pause & Report to User]
    G -.->|Failure| I
```

## Common Mistakes

- Passing the spec content inline instead of the file path — always pass the path so opencode can read it
- Skipping the secondary evaluation and blindly applying all cursor suggestions
- Not including codebase context in the review prompt, leading to generic feedback
- Looping for multiple review rounds instead of one round as specified

## Red Flags

- Cursor review has no confidence ratings — prompt was malformed, stop and fix
- Spec file cannot be found after brainstorming — check path before proceeding
- User interrupts mid-flow with new requirements — stop, clarify, and restart if needed
- Attempting to skip brainstorming because "we already discussed it" — the spec must be materialized as a document
