---
name: using-xiaohongshu
description: Publish a note (图文/长文) to Xiaohongshu / 小红书 through the creator backend in the shared Chrome — draft the title and body, generate a local cover image, upload, fill, publish, and verify it landed. Use when the user asks to post to 小红书, 发小红书/发笔记/发条小红书, draft a note, or make a cover image for one.
---

# Using Xiaohongshu

Publishing goes through the creator backend `creator.xiaohongshu.com` in the **shared Chrome** — the account is already logged in there. Never spin up a fresh headless instance: the login state only exists in the shared profile. If the instance is not running, start it with the `shared-chrome` skill.

Every browser action goes through the `agent-browser` skill: it owns the session, the attach, selectors, refs and snapshots. This file lists only *what* to do on the page, never *how* to drive the browser — invoke `agent-browser` and let that skill choose the calls.

## 1. Open the publish page

Have `agent-browser` open a new labeled tab, label `xhs`, at `https://creator.xiaohongshu.com/publish/publish?source=official`.

## 2. Confirm the account before writing anything

The logged-in handle sits in the top bar of the publish page. Read it and report it to the user if the draft will be published publicly — publishing to the wrong account is not recoverable by an edit.

## 3. Draft the note

- **Title**: ≤ 20 characters on Xiaohongshu. Concrete beats clever; name the finding, not the topic area.
- **Body**: hard limit 1000 characters. Xiaohongshu style — short lines, blank line between blocks, `①②③` for sections, no external links (they are suppressed), hashtags as a trailing line (`#AI #大模型 ...`).
- **Credibility**: include the sample size / date / method caveat in the body. Readers discount unqualified "I tested it" claims, and a stated limitation is what survives being challenged in comments.
- Keep the draft in a file (`/tmp/xhs/body.txt`) and have it filled from that file — pasting long Chinese text through a shell argument invites quoting damage.

## 4. Cover image (generated locally, not a screenshot)

Generate with ImageMagick plus a CJK font. Check the font name first: `fc-list :lang=zh family | grep -i sans`.

```bash
magick -size 1080x1440 gradient:'#0b1020-#1b2440' \
  -gravity north -fill '#7dd3fc' -font 'Noto-Sans-CJK-SC-Bold' -pointsize 44 -annotate +0+150 'API 观察笔记' \
  -fill white -pointsize 78 -annotate +0+260 '第一行标题' \
  -fill '#fbbf24' -pointsize 78 -annotate +0+460 '要点行' \
  cover.png
```

Conventions:

- **The text block is vertically centered — house rule, not a suggestion.** Place the first line so the whole block (kicker + title lines + subtitle) is optically centered in the 1080×1440 canvas. Do not top-align it, and do not fill the leftover space with filler lines.
- No decorative disclaimers ("自制封面 · 个人实测"). They are written for the platform, not the reader, and they cost a line of attention. Put caveats in the body instead.
- If a subtitle earns its place, make it carry information (a number, a date, the sample size), not a restatement of the title.
- Read the PNG back (`read /tmp/xhs/cover.png`) and look at it before uploading — annotation offsets are easy to get wrong.

## 5. Upload and fill

Two traps, both silent:

1. **The 图文 tab must be active first.** On the publish page the only `input[type=file]` initially accepts video (`.mp4,.mov,...`). Click 「上传图文」, then have `agent-browser` read back the `accept` attribute of every `input[type=file]` on the page — it must list `.jpg,.jpeg,.png,.webp` before the cover is uploaded.
2. **The title field is not the first `input` on the page.** Address it by placeholder (`填写标题会有更多赞哦`), not by position. The body is a `contenteditable`, not a textarea.

Then, through `agent-browser`: upload `/tmp/xhs/cover.png` into the file input, fill the title, fill the body from `/tmp/xhs/body.txt`.

## 6. Verify before publishing

Read the body back — `fill` can land truncated. Have `agent-browser` return the `contenteditable` element's `innerText` length, first 40 characters and last 60 characters.

Check: character count under 1000, tail ends with the hashtag line, title shows the intended text.

## 7. Publish and confirm

Click 「发布」, then confirm in **two** places — the success page alone is not proof:

1. the success page at `https://creator.xiaohongshu.com/publish/success`
2. the note manager at `https://creator.xiaohongshu.com/new/note-manager` — status must show 审核中 (or 已发布); open it through `agent-browser`

Report the resulting status and timestamp back to the user.

## Limits worth telling the user up front

- **A published note cannot be edited via the creator backend**, and the cover cannot be replaced. Changing wording or image means deleting and reposting — say this before publishing, not after.
- New notes sit in 审核中 for a while; the publish outcome is not final until review passes.
- Naming a third party in the note makes it a factual claim that must be backed by your own evidence (response headers, measured numbers). Keep the tone descriptive, not accusatory — "it routes through third-party hosts" is a fact; "it is a scam" is not.

## Do not

- Do not log in / switch accounts in the shared Chrome for a post.
- Do not close the shared Chrome or its tabs after publishing — the user's other sessions depend on it.
- Do not paste API keys, internal hostnames, or private endpoints into a draft; if the draft needs a key to make its point, replace it with a redacted placeholder.
