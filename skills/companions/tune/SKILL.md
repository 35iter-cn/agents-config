---
name: tune
description: Tune companion model tiers via natural language — view, set, reset, or get recommendations.
category: workflow
date_added: "2026-05-29"
---

## Overview

Tune companion model configurations (opencode, cursor, omp, codex) through natural language commands. Detects user intent, interacts with companion CLIs to read or write tier settings, and presents results in a clear table.

## When to Use

- User asks to view, set, reset, or get recommendations for companion model tier configuration
- User mentions model names or tiers in context of companion tools

## When NOT to Use

- Configuring non-companion tools
- Running companion tasks (use `runx` skill instead)
- User is asking about model behavior or capability, not configuration

## Quick Reference

### 1. Detect intent

Parse the natural-language prompt and classify into one of these intents:

| Intent | Keywords (examples) |
|---|---|
| `show` | "show", "view", "get", "what", "current" |
| `set` | "set", "change", "update", "use" |
| `reset` | "reset", "clear", "unset" |
| `recommend` | "recommend", "suggest", "what should" |
| `unclear` | No clear match |

### 2. Execute action

**show:**
- Run `node $CLAUDE_SKILL_DIR/scripts/companion.mjs models --get [adaptor]` for the relevant adaptor.
- Format output as a tier-column table (left-align with fixed spacing, `—` for unconfigured tiers).
- If only one adaptor is configured, show that. Both empty → report "No configuration found" and offer to recommend.

**set:**
- Parse which adaptor (`opencode`/`cursor`/`omp`/`codex`) and tier (`low`/`medium`/`high`/`maximum`). Default adaptor: `opencode`.
- If tier missing, show current config and ask.
- Pipe a JSON config to stdin: `echo '{"<adaptor>": {"<tier>": "<model>"}}' | node $CLAUDE_SKILL_DIR/scripts/companion.mjs models --set`.
- Before executing, confirm with the user unless the exact model was uniquely resolved and the user already implicitly confirmed.
- Report success or error.

**reset:**
- Determine which adaptor to reset. If unspecified, ask.
- Show current config for that adaptor, ask confirmation.
- Run `node $CLAUDE_SKILL_DIR/scripts/companion.mjs models --reset <adaptor>`.
- Report success or error.

**recommend:**
- Run `node $CLAUDE_SKILL_DIR/scripts/companion.mjs models --list` to see available models.
- Classify available models by capability tier based on model ID heuristics.
- Present recommendations alongside current config.
- Ask if user wants to apply. If yes, present proposed config, confirm, execute as in `set`.

**unclear:**
- Show current config via `node $CLAUDE_SKILL_DIR/scripts/companion.mjs models --get`.
- Ask the user what they'd like to do (show something else, set a tier, reset, recommend).

### 3. Display result

Always show the final state after any write operation by running `--get` again and rendering the table.

## Core Flow

```mermaid
flowchart TD
    A([Start]) --> B[Detect intent]
    B --> C{Intent}
    C -->|show| D[Run --get, format table]
    C -->|set| E[List models, confirm, --set]
    C -->|reset| F[Confirm, --reset]
    C -->|recommend| G[List, classify, offer to apply]
    C -->|unclear| H[Show current, ask]
    D --> I([Done])
    E --> I
    F --> I
    G --> I
    H --> I
```

## Common Mistakes

- Calling `--set` or `--reset` without confirming with the user first.
- Passing `--modelTier` or `--companion` flags to the `models` subcommand (they are not supported).
- Confusing adaptor names — `codex` has no `--list-models` command; its model config comes from `model-map.json`.
- Not re-running `--get` after a write to confirm the change took effect.
- Silently falling back to stale data when `--list` fails.

## Red Flags

- `--list` fails for all adaptors — companion CLIs may not be installed or configured.
- User asks to set a model that does not appear in `--list` output — warn but allow.
- Multiple resets without verification — configuration drift.
- `--get` fails — show a clear warning but attempt to continue with partial data.
