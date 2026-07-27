---
description: |
  Trigger when the user explicitly asks a companion to execute a task — regardless of task complexity or duration.
---

# Overview

Dispatch user requests to another companion via `companion.mjs` script.

## Process flow

You MUST create a task for each of these items and complete them in order.

### 1. Classify Intent and Extract Parameters

- `$mode` — Defaults to `NEW`. Set to `RESUME` only when continuing an existing companion session.
- `$companion` — Valid companions are `opencode`, `cursor`, `omp`, and `codex`. If the user names any of these, use that name verbatim as `--companion`. Only default to `opencode` when the user does not specify a companion.
- `$modelTier` — Infer from task complexity (see table below) or use the user's explicit request.
- `$files` — File paths relevant to the user's intent and the task.
- `$context` — Background information from the current conversation that helps the companion understand the task. Include relevant decisions, constraints, or findings already discussed. Omit if the task is self-contained.
- `$task` — The user's original intent after stripping extracted parameters. May be expanded, but preserve the user's key terms.
- `$sessionID` — Required only for `RESUME` mode. The session ID returned by the companion after a `NEW` run.
- **Companion selection rule:** Do not pre-check CLI availability, and do not lecture the user about whether a companion is a "headless CLI" or an IDE. If the user names a valid companion, launch with it; if the CLI is missing, the command will fail with a clear error that you can report concisely.

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
$tmpfile = $(node $CLAUDE_SKILL_DIR/scripts/companion.mjs tmpfile)
echo "$finalPrompt" > "$tmpfile"
```

`$CLAUDE_SKILL_DIR/scripts/companion.mjs tmpfile` automatically generates `/tmp/companions/prompt-{adjective}-{noun}.md`
with collision detection (up to 10 retries).

### Launch the Companion

The companion is a long-running background process. It writes progress events to stdout and produces a final summary file. You MUST launch it through a tool/mechanism in the current harness that satisfies all of the following:

1. **Runs detached from the current response turn** — the companion can outlive a single exchange.
2. **Streams each stdout line as a discrete event/notification** — every line the companion prints must be surfaced to the conversation in real time, not batched and delivered only at completion.
3. **Supports an open-ended or long timeout** — at least one hour.

**Do NOT:**
- Output or run the `companion.mjs launch` command directly in your response text.
- Use a tool that only reports the final result after the process exits.
- Use a tool that buffers all output and delivers it as a single block.

In harnesses where multiple tools appear to satisfy these criteria, prefer the one whose primary purpose is real-time event streaming from a long-running shell command.

You **must** declare the selected tool and its parameters to the user before proceeding:

```
[EXECUTION_SELECTION] Tool: [tool name] with params [key parameters]
[EXECUTION_SELECTION] Reason: [one-sentence explanation]
```

**Assemble and run:**

```bash
# $CLAUDE_SKILL_DIR/scripts/companion.mjs --help for usage instructions
node $CLAUDE_SKILL_DIR/scripts/companion.mjs launch --companion $companion --modelTier $modelTier --prompt-path $tmpfile
```

If in RESUME mode, add `--session "$sessionID"`

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
- **Polling companion output repeatedly.** The companion only emits output at key milestones (start, retry, completion). No output for minutes at a time is normal — the companion is working. Do not `tail` the output file repeatedly, do not run `sleep && tail` loops, and do not assume the companion is stuck just because there is no new output. Wait for the background task completion notification or the final `{"type":"done"}` marker.
