---
name: runx
description: |
  Trigger when the user explicitly asks a companion to execute a task — regardless of task complexity or duration.
category: workflow
date_added: "2026-06-03"
---

# Overview

This skill enables delegation of any task to other companion agents via the companion.mjs script. Supported companions include opencode, cursor, omp, and codex — all are agent CLI tools.

## When NOT to Use

- One-off commands in the current environment.
- Questions answerable directly without companion involvement.

## Workflow

You MUST create a task for each step and complete them sequentially.

### Classify Intent and Extract Parameters

- `$mode` — Defaults to `NEW`. Set to `RESUME` only when continuing an existing companion session.
- `$companion` — Defaults to `opencode` unless the user explicitly specifies otherwise.
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

### Tool Selection Pre-Check (Mandatory)

Before executing the companion command, you MUST complete the following checks in order and select the tool based on the result:

1. Is the `Monitor` tool available?
   - **Yes** → You MUST use `Monitor({ command: "$companionCommand", persistent: true })`. Skip to Execution.
   - **No** → Continue to the next check.

2. Is a `job` tool with `poll` support available?
   - **Yes** → Use `bash({ command: "$companionCommand", async: true })` followed by `job({ poll: ["bg_<id>"] })`. Skip to Execution.
   - **No** → Continue to the next check.

3. Is only `bash` available (no Monitor, no job)?
   - **Yes** → Use `bash({ command: "$companionCommand", timeout: 3600000 })`.
   - **No** → Report an error and stop.

### Execution

Construct the `$companionCommand` for launching the companion using all inferred parameters:

```
node "${CLAUDE_SKILL_DIR}/scripts/companion.mjs" run --companion $companion --modelTier $modelTier < "$tmpfile"
```

Execute the command using the tool selected in the pre-check above.

### Pre-Execution Declaration

After constructing `$companionCommand` but before invoking any tool, you MUST explicitly output the following in your reasoning:

```
[TOOL_SELECTION] Checked available tools: Monitor=[yes/no], job-poll=[yes/no], bash-only=[yes/no]
[TOOL_SELECTION] Selected tool: [Monitor/job/bash]
[TOOL_SELECTION] Reason: [one-sentence explanation]
```

Proceed with execution only if the `[TOOL_SELECTION] Selected tool` matches the priority order of available tools.

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
