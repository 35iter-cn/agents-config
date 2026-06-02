---
name: runx
description: Delegate tasks to a companion CLI with session-aware resumption support. A companion is an external AI agent that can execute long-running tasks and maintain context across multiple interactions.
category: workflow
date_added: "2026-05-29"
---

## When to Use

- User asks to resume or continue a previous companion session
- User wants to delegate a long-running task that may span multiple interactions
- User explicitly references a "companion" with a task description
- Task requires session-aware context that outlives a single command

## When NOT to Use

- Simple local commands — one-off file reads, git status, or quick edits
- User says "run this in terminal" or "execute locally" — implies the current environment
- Exploratory questions — "what is X?" or "how does Y work?" should be answered directly

## Quick Reference

$cli_path: `<current_skill_root>/scripts/companion.mjs`

### Classify Intent and Extract Parameters

**Step 1: Classify Mode**
Does the user input contain resumption intent (e.g., `resume`, `continue`, `go back to`)?

- **Yes** → RESUME mode, proceed to Step 2
- **No** → NEW mode, proceed to Step 2

**Step 2: Extract Parameters**

| Parameter    | Description                 | NEW Mode Source                                                    | RESUME Mode Source                             |
| ------------ | --------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| `$task`      | Core task description       | Remaining text after parameter extraction                          | Resumption intent or new directive             |
| `$companion` | Target companion type       | User mention (e.g., cursor, Claude Code, omp, opencode) or default | Inherit from original session or user override |
| `$files`     | Contextually relevant files | Related file paths from context                                    | Related file paths from context                |
| `$modelTier` | Model capability level      | User-specified or inferred from complexity                         | Inherit from original session or user override |

**RESUME-specific:**
| Parameter | Source | On No Match |
|---|---|---|
| `$sessionID` | Match history by companion reference or task similarity | Ask whether to start a new task |

**Model Tier Inference:**
| Complexity | Tier |
|---|---|
| Simple questions, trivial edits | `low` |
| Day-to-day features, localized refactors | `medium` |
| Multi-file refactors, architecture changes | `high` |
| Repository-wide changes | `maximum` |

### Compose Final Prompt

**MANDATORY:** Prompt must be composed strictly from the templates below. No structural modifications allowed.

**Step 1: Select Template**

| Mode   | Template Structure     | Why                                                  |
| ------ | ---------------------- | ---------------------------------------------------- |
| NEW    | Task + Context + Rules | Full context and decision rules required             |
| RESUME | Task + Changes         | Historical context already exists; only delta needed |

**Step 2: Fill Variables**

Replace placeholders only. Do not add, remove, merge, or reorder sections.

| Placeholder              | Replacement                                                        |
| ------------------------ | ------------------------------------------------------------------ |
| `{{$task}}`              | Core task description                                              |
| `{{$files}}`             | Relevant file paths; omit entire Context section for trivial tasks |
| `{{$technical_context}}` | Codebase background and architecture                               |

**Templates**

NEW mode:

```
## Task
{{$task}}

## Context
{{$technical_context}}
{{$files}}

## Rules
- **Mandatory:** When uncertain about the next step, list the options, mark the best one with ⭐, and end with `[NEEDS_DECISION: <reason>]`.
```

RESUME mode:

```
{{$task}}

{{$files}}
```

### Execute by Your Platform

**Prerequisites**

- `$finalPrompt` composed from template
- All information extracted (Step 2)
- The environment has a companion CLI installed and available in PATH

**Execution**

Run the companion CLI with the composed prompt:

```bash
node $cli_path run --agent $companion --model $modelTier <<'__EOF__'
${finalPrompt}
__EOF__
```

For RESUME mode, add `--session "${sessionID}"` before the heredoc.

**Variable mapping:** `$runCmd` is the command template defined in the Execution section above.

**Execution (pick one based on your platform):**

| Platform        | Execution (pseudocode)                                                        | Notes                                      |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------------ |
| **Claude Code** | `Monitor({ command: "$runCmd" })`                                             | Background execution with streaming output |
| **OMP**         | `bash({ command: "$runCmd", async: true })` → `job({ poll: ["bg_<id>"] })`    | Async launch then poll                     |
| **OpenCode**    | `bash({ command: "$runCmd", timeout: 3600000 })`; use `task` for complex tasks | Long timeout foreground execution          |
| **Other**       | Adapt to platform's async job mechanism                                       | —                                          |

### Handle Response

Companion streams output, then final line: `{"type":"done","success":bool,"summary":{"finalMessage":"...","sessionID":"...","sessionError":"..."}}`

**Response Paths**

| Path     | Trigger                              | Action                                          |
| -------- | ------------------------------------ | ----------------------------------------------- |
| Error    | `sessionError` present               | Report error and stop                           |
| Decision | `[NEEDS_DECISION]` in `finalMessage` | [Decision Path Details](#decision-path-details) |
| Default  | Neither above                        | Summarize companion's results                   |

#### Decision Path Details

When companion returns `[NEEDS_DECISION: ...]`:

1. **Parse** — Extract all options and the ⭐-marked recommendation from `finalMessage`.
2. **Evaluate** — Combine companion's analysis with your existing context. The ⭐ is a strong signal, not an order — use your own judgment.
3. **Decide** — Select the option that best advances the task. Priority: your judgment + ⭐ companion recommendation > task alignment > specificity > first option.
4. **Resume** — Execute RESUME mode via `Execute by Your Platform` with the chosen option, same `$sessionID` and `$modelTier`.

## Core Flow

```mermaid
flowchart TD
    A([Start]) --> B[Classify Intent and Extract Parameters]
    B --> C[Compose Final Prompt]
    C --> D[Execute by Your Platform]
    D --> E[Handle Response]
    E --> F([Done])
```

## Common Mistakes

- Using file contents instead of file paths in `$files`.
- Not extracting `$sessionID` before resuming — creates a new session instead of continuing.

## Red Flags

- `[NEEDS_DECISION]` without a ⭐-marked option — companion is uncertain, escalate.
- **Asking the user on `[NEEDS_DECISION]`** — violation. See Decision Path Details.
- Multiple `sessionError` in a row — companion may be broken, fall back to direct execution.
- Empty `finalMessage` after a long execution — likely timeout or silent failure.
- **Prompt structure deviates from template** — violation. See Compose Final Prompt.
- **Skipping companion verification** — always confirm the companion CLI is available (`which companion` or equivalent) before attempting delegation. Do not assume unavailability without checking.
