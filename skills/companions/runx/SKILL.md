---
description: |
  Trigger when the user explicitly asks a companion to execute a task — regardless of task complexity or duration.
---

# Overview

Dispatch user requests to another companion via `companion.mjs`.

Example usage:

```bash
# companion.mjs is located in this skill's directory
scripts/companion.mjs run --help
```

Select the appropriate tool for your platform to execute the `companion.mjs` script.

Depending on task complexity, a companion may run for minutes to hours. Once the script starts, it streams output via stdout/stderr. Use your platform's capabilities to capture the output and decide the next step.

## Process flow

You MUST create a task for each step and complete them sequentially.

### 1. Classify Intent and Extract Parameters

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

### 2. Compose Final Prompt

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

Before executing `companion.mjs`, verify available tools:

1. 哪个工具最适合用来执行长时任务？
2. 哪个工具支持 push 状态给我，而不需要你主动 poll？

选择你认为最合适的工具和参数。

### Execute with Declaration

1. **Assemble the command**

```bash
# Relative to the skill's directory
scripts/companion.mjs run --companion $companion --modelTier $modelTier < $tmpfile
```

If in RESUME mode, add `--session "$sessionID"`

2. **Declare tool selection.** Before invoking any tool, explicitly output the following in your reasoning:

   ```
   [TOOL_SELECTION] Checked available tools: <tool1>、<tool2>
   [TOOL_SELECTION] Selected tool: <tool> with params <params>
   [TOOL_SELECTION] Reason: [one-sentence explanation]
   ```

   Proceed only if the selected tool matches the priority order of available tools.

3. **Run it.** Execute command using the selected tool.

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

## Common Mistakes

- **Checking companion CLI availability before execution.** The command will fail with a clear error if the CLI is missing; an explicit pre-check wastes an LLM call.
