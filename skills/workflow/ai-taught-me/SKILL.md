---
name: ai-taught-me
description: Manage the personal AI-taught-me knowledge repository — write new case studies/cheat sheets and query existing knowledge. Use when the user asks to save, document, or record knowledge, tips, or solutions, to search or look up previously documented knowledge, or mentions "AI-taught-me".
category: workflow
date_added: "2026-05-29"
---

# AI-taught-me

Manage the knowledge repo at `~/code/AI-taught-me`. Two modes: **write** (document knowledge) and **query** (retrieve it).

## Mode Routing

- `--mode write|query` flag wins
- No flag → infer: save/record/document → write; search/find/lookup → query
- Still ambiguous → ask: `1. write  2. query`

## Shared Rules

- `REPO=~/code/AI-taught-me` — set it in every Bash command (shell state does not persist). If the directory is missing, stop and tell the user; do not search for it.
- Structure: `$REPO/<category>/<topic>/` — exactly 2 levels, kebab-case.
- Choose category/topic autonomously — **never ask the user**. `ls "$REPO"` first and reuse an existing category when one fits; a wrong guess is fixed later with `git mv`, so just state the chosen path in your summary.

## Execute

- write → [workflows/write.md](workflows/write.md)
- query → [workflows/query.md](workflows/query.md)
