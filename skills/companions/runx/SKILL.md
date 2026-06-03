---
name: runx
description: |
  Trigger when the user explicitly asks a companion to execute a task — regardless of task complexity or duration.
category: workflow
date_added: "2026-06-03"
---

## When NOT to Use

- One-off commands in the current environment.
- Questions answerable directly without companion involvement.

## Workflow

You MUST create a task for each item and complete them in order.

### Classify Intent and Extract Parameters

- `$mode` — Defaults to `NEW`. Set to `RESUME` only when continuing an existing companion session.
- `$companion` — Defaults to `opencode` unless the user explicitly names one of: `cursor`, `omp`, `codex`.
- `$modelTier` — Infer from task complexity (see table below) or use the user's explicit request.
- `$files` — File paths relevant to the user's intent and the task.
- `$context` — Background information from the current conversation that helps the companion understand the task. Include relevant decisions, constraints, or findings already discussed. Omit if the task is self-contained.
- `$task` — The user's original intent after stripping extracted parameters. May be expanded, but preserve the user's key terms.
- `$sessionID` — Required only for `RESUME` mode. The session ID returned by the companion after a `NEW` run.

**Model Tier Inference:**

| Complexity                                 | Tier      |
| ------------------------------------------ | --------- |
| Simple questions, trivial edits            | `low`     |
| Day-to-day features, localized refactors   | `medium`  |
| Multi-file refactors, architecture changes | `high`    |
| Repository-wide changes                    | `maximum` |

### Compose Final Prompt

**Step 1: Select template by mode**

`NEW` mode template:

```
## Task
{{$task}}

## Context
{{$files}}
{{$context}}

## Rules
- **Mandatory:** When uncertain about the next step, list the options, mark the best one with ⭐, and end with `[NEEDS_DECISION: <reason>]`.
```

`RESUME` mode template:

```
{{$task}}

{{$files}}

{{$context}}
```

When generating the final prompt, strictly follow these formatting rules:

- Replace template variables with actual content.
- Do not add extra level-2 headings (the templates above define the complete heading structure).
- `$files` must contain only file paths, never file contents.
- `$context` must be concise prose — extract only what's relevant from the conversation; don't dump the full transcript.
- If `## Context` would be empty (no `$files` and no `$context`), omit the entire `## Context` heading and its content from the prompt.

**Step 2:** Write `$finalPrompt` to a temporary file (`$tmpfile`), then verify its contents match the chosen template format — if not, redo Step 1.

### Execution

You must pick the execution method by **tool availability**, not by who you think you are. Do not guess your platform — check which runtime tools you actually have:

| If you have this tool            | Use this                                                                   | Why                                                             |
| -------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `Monitor`                        | `Monitor({ command: "$runCmd" })`                                          | Background execution with streaming output; Claude Code native. |
| A `job` tool with `poll` support | `bash({ command: "$runCmd", async: true })` → `job({ poll: ["bg_<id>"] })` | Async launch then poll for completion; OMP native.              |
| Only `bash` (no Monitor, no job) | `bash({ command: "$runCmd", timeout: 3600000 })`                           | Long timeout foreground; OpenCode and fallback.                 |
| None of the above                | Adapt to whatever async job mechanism your runtime provides.               | Unknown platform — extrapolate from available tools.            |

`$runCmd` is the following CLI command:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/companion.mjs" run --companion $companion --modelTier $modelTier < "$tmpfile"
```

**RESUME mode**: Append `--session "${sessionID}"` after `--modelTier`.

### Handle Response

The companion streams output, ending with a final JSON line:

```
{"type":"done","success":bool,"summary":{"finalMessage":"...","sessionID":"...","sessionError":"..."}}
```

**Response paths**

| Path     | Trigger                              | Action                                          |
| -------- | ------------------------------------ | ----------------------------------------------- |
| Error    | `sessionError` present               | Report error and stop                           |
| Decision | `[NEEDS_DECISION]` in `finalMessage` | [Decision path details](#decision-path-details) |
| Default  | Neither above                        | Summarize companion's results                   |

#### Decision Path Details

When the companion returns `[NEEDS_DECISION: ...]`:

1. **Parse** — Extract all options and the ⭐-marked recommendation from `finalMessage`.
2. **Evaluate** — Combine the companion's analysis with your existing context. The ⭐ is a strong signal, not an order — use your own judgment.
3. **Decide** — Select the option that best advances the task. Priority: your judgment + ⭐ recommendation > task alignment > specificity > first option.
4. **Resume** — Execute `RESUME` mode via your platform's execution method with the chosen option, using the same `$sessionID` and `$modelTier`.
