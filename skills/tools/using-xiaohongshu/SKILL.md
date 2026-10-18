---
name: using-xiaohongshu
description: Publish a note (图文/长文) to Xiaohongshu / 小红书 through the creator backend in the shared Chrome — draft the title and body, generate a local cover image, upload, fill, publish, and verify it landed. Use when the user asks to post to 小红书, 发小红书/发笔记/发条小红书, draft a note, or make a cover image for one.
---

# Using Xiaohongshu

Publishing goes through the creator backend `creator.xiaohongshu.com` in the **shared Chrome** (CDP 9222) — the account is already logged in there. Never spin up a fresh headless instance: the login state only exists in the shared profile.

Companion skills: `shared-chrome` (start/verify the instance), `agent-browser` (browser CLI rules — named session, attach verification, ref discipline).

## 1. Attach to the shared Chrome

Re-derive the session in **every** bash call (a fresh shell does not keep exports), then attach and prove it:

```bash
export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix "agentbrowser-${PI_SESSION_ID:0:8}")"
agent-browser connect 9222
agent-browser eval "document.title = 'AB-MARK-' + Date.now()"
curl -fsS http://127.0.0.1:9222/json | grep -c AB-MARK   # 1 = attached to the shared browser
agent-browser eval "navigator.userAgent"                  # must NOT contain HeadlessChrome
```

Then open a labeled tab: `agent-browser tab new --label xhs "https://creator.xiaohongshu.com/publish/publish?source=official"`.

## 2. Confirm the account before writing anything

`snapshot -i -c` shows the logged-in handle in the top bar. Report it to the user if the draft will be published publicly — publishing to the wrong account is not recoverable by an edit.

## 3. Draft the note

- **Title**: ≤ 20 characters on Xiaohongshu. Concrete beats clever; name the finding, not the topic area.
- **Body**: hard limit 1000 characters. Xiaohongshu style — short lines, blank line between blocks, `①②③` for sections, no external links (they are suppressed), hashtags as a trailing line (`#AI #大模型 ...`).
- **Credibility**: include the sample size / date / method caveat in the body. Readers discount unqualified "I tested it" claims, and a stated limitation is what survives being challenged in comments.
- Keep the draft in a file (`/tmp/xhs/body.txt`) and pass it with `fill "$(cat ...)"` — inlining long Chinese text through the shell invites quoting damage.

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

1. **The 图文 tab must be active first.** On the publish page the only `input[type=file]` initially accepts video (`.mp4,.mov,...`). Click the 「上传图文」 tab, then re-check:

   ```bash
   agent-browser eval "JSON.stringify([...document.querySelectorAll('input[type=file]')].map(i=>i.accept))"
   # must show .jpg,.jpeg,.png,.webp before uploading
   ```

2. **The title field is not the first `input` on the page.** Address it by placeholder via the snapshot ref (`填写标题会有更多赞哦`); the body is a `contenteditable`, not a textarea.

```bash
agent-browser upload "input[type=file]" /tmp/xhs/cover.png
agent-browser fill @<title-ref> "标题文本"
agent-browser fill @<body-ref> "$(cat /tmp/xhs/body.txt)"
```

## 6. Verify before publishing

Read the fields back — `fill` can land truncated:

```bash
agent-browser eval "(() => { const b=document.querySelector('[contenteditable=true]'); const t=b.innerText;
  return JSON.stringify({len:t.length, head:t.slice(0,40), tail:t.slice(-60)}); })()"
```

Check: character count under 1000, tail ends with the hashtag line, title shows the intended text.

## 7. Publish and confirm

Click 「发布」, then confirm in **two** places — the success page alone is not proof:

```bash
# 1) success page
#    https://creator.xiaohongshu.com/publish/success
# 2) note manager — status must show 审核中 (or 已发布)
agent-browser open "https://creator.xiaohongshu.com/new/note-manager"
```

Report the resulting status and timestamp back to the user.

## Limits worth telling the user up front

- **A published note cannot be edited via the creator backend**, and the cover cannot be replaced. Changing wording or image means deleting and reposting — say this before publishing, not after.
- New notes sit in 审核中 for a while; the publish outcome is not final until review passes.
- Naming a third party in the note makes it a factual claim that must be backed by your own evidence (response headers, measured numbers). Keep the tone descriptive, not accusatory — "it routes through third-party hosts" is a fact; "it is a scam" is not.

## Do not

- Do not log in / switch accounts in the shared Chrome for a post.
- Do not close the shared Chrome or its tabs after publishing — the user's other sessions depend on it.
- Do not paste API keys, internal hostnames, or private endpoints into a draft; if the draft needs a key to make its point, replace it with a redacted placeholder.
