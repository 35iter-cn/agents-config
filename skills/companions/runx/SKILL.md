---
description: |
  Trigger when the user explicitly asks a companion to execute a task — regardless of task complexity or duration.
---

# Overview

Dispatch user requests to another companion via `companion.mjs` script.

> `$script_path` = current skill directory + `scripts/companion.mjs`

## Process flow

You MUST create a task for each of these items and complete them in order.

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

**Step 2:** Generate a temporary file path and write `$finalPrompt` to it.

```bash
$tmpfile = $(node "$script_path" tmpfile)
echo "$finalPrompt" > "$tmpfile"
```

`companion.mjs tmpfile` automatically generates `/tmp/companions/prompt-{adjective}-{noun}.md`
with collision detection (up to 10 retries).

### Execution Capability Check (Mandatory)

Companion execution is open-ended. Even questions that appear simple often require exploration, retries, or multi-step work. **Assume the task will exceed 1 hour** when selecting execution parameters.

Before executing `companion.mjs`, verify the execution method satisfies these requirements:

1. Supports processes that run longer than one hour without timing out.
2. Captures stdout/stderr output as it streams, line by line.
3. Pushes each output line to you automatically — no polling or periodic checking.
4. Persists across conversation turns until the companion emits its final JSON line.

Select the most appropriate tool and parameters.

### Execute with Declaration

1. **Declare execution method selection.** Before invoking the execution method, explicitly output the following in your reasoning:

   ```
   [EXECUTION_SELECTION] Verified requirements: [requirement1], [requirement2], [requirement3], [requirement4]
   [EXECUTION_SELECTION] Selected method: [method] with params [params]
   [EXECUTION_SELECTION] Reason: [one-sentence explanation]
   ```

2. **Assemble the command**

```bash
# node $script_path --help for usage instructions
node "$script_path" launch --companion $companion --modelTier $modelTier --prompt-path $tmpfile
```

If in RESUME mode, add `--session "$sessionID"`

3. **Run it.** Execute command using the selected method.

### Handle Response

The companion streams output, ending with a final JSON line (done marker):

```
{"type":"done","success":bool,"summaryPath":"/tmp/companions/summary-happy-cat.jsonl"}
```

**Read the summary file** from `summaryPath`, then follow response paths:

| Path     | Trigger                              | Action                                          |
| -------- | ------------------------------------ | ----------------------------------------------- |
| Error    | `sessionError` present in summary    | Report error and stop                           |
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
