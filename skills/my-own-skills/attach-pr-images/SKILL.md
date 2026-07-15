---
name: attach-pr-images
description: Attach local images to a GitHub PR body via a dedicated assets branch and the Contents API — no browser session needed, works for private repos. Use when adding screenshots to a PR description, when gh pr create/edit needs embedded images, or when the user asks to put images into a GitHub PR or issue.
category: workflow
date_added: "2026-07-15"
---

# Attach PR Images

GitHub has no official API for issue/PR comment attachments; true `user-attachments` URLs require a browser session. This skill embeds images that render for anyone logged in with repo access (private repos included) using only a `gh` token.

## How it works

1. A long-lived `pr-assets` branch (one per repo, created from the default branch on first use) stores images under `pr-<number>/`.
2. Upload via Contents API (`gh api repos/.../contents/... -X PUT`) — no branch switching, works from any cwd.
3. Embed `https://github.com/<owner>/<repo>/raw/pr-assets/<path>` — a same-host URL, authorized by the viewer's browser session. **Never** `raw.githubusercontent.com` (404 for private repos).
4. Splice the image lines into the PR body section and `gh pr edit`.

## Quick start

```bash
node scripts/attach-pr-images.mjs --repo owner/repo --pr 5441 workspace.jpeg detail.jpeg
```

Uploads (idempotent), updates the PR's `## Screenshots / Videos` section (created if missing), prints the markdown lines. Omit `--pr` to only upload and print markdown for manual pasting; `--dir` overrides the default `pr-<number>/` folder.

## Rules

- Name files meaningfully before upload (`workspace-overview.jpeg`, not `01.jpeg`) — the filename becomes the URL.
- Filenames must match `^[\w.-]+$` (URLs break on spaces); rename first.
- Never put images on the PR's own branch — they enter the PR diff and may trigger CODEOWNERS review.
- Verify with the script's built-in check (raw.githubusercontent.com + token). Do **not** curl the embedded `github.com/.../raw/...` URL with a token: it is session-only, returns 404 — a false alarm.

## Limitations & fallback

- Videos attach as plain links (inline playback requires real `user-attachments` URLs).
- Gist cannot store binary; external image hosts leak internal UI — neither is acceptable for private screenshots.
- If true `user-attachments` URLs are mandatory: `gh extension install theolundqvist/gh-img`, then `gh img <file> --repo owner/repo`. Reads local browser cookies against an unofficial endpoint; breaks when the session rotates.
