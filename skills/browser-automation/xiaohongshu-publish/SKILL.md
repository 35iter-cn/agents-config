---
name: xiaohongshu-publish
description: Publish image-text notes on Xiaohongshu (小红书) via Chrome MCP and the creator center. Covers opening the publish page, uploading images (CDP workaround), filling title/body/topics within platform limits, submitting, and verifying the note link. Use when the user asks to post on 小红书, publish a note, or automate Xiaohongshu creator workflows.
---

# Xiaohongshu Publish

Publish **image-text notes** on Xiaohongshu through the web creator center, using `chrome-devtools` MCP on the shared debug Chrome instance.

## When to Use

- User asks to open/publish on 小红书 or Xiaohongshu.
- User wants to post an image-text note with optional topics.
- User asks to automate note creation after drafting copy elsewhere.

## When NOT to Use

- Video notes (different tab: 上传视频).
- Mobile app only — this skill targets **PC web creator center**.
- User is not logged in — stop and ask them to log in first.

## Content limits

Enforce before filling the form (and trim/ask if the user draft exceeds):

| Field | Limit | UI hint |
|-------|-------|---------|
| Title | **≤ 20 characters** | Placeholder: 「填写标题会有更多赞哦」 |
| Body | **≤ 1000 characters** | Counter shows `N/1000` |

Count Chinese characters, Latin letters, digits, and punctuation the same way the creator UI does (one code point ≈ one counter unit). Topics inserted via the **话题** picker count toward the body limit.

## Prerequisites

1. **`chrome-debug` skill** — debug Chrome on `http://127.0.0.1:9222`.
2. **`chrome-devtools` MCP** — `new_page`, `navigate_page`, `take_snapshot`, `fill`, `click`, `type_text`, `wait_for`.
3. **Logged-in Xiaohongshu account** in that Chrome profile.
4. **Images on disk** (if uploading) — local paths the agent can read; see [File upload](#file-upload).

## URLs

| Step | URL |
|------|-----|
| Home (logged in) | `https://www.xiaohongshu.com/explore` |
| Creator publish | `https://creator.xiaohongshu.com/publish/publish?source=official` |
| Note manager | `https://creator.xiaohongshu.com/new/note-manager` |
| User profile | `https://www.xiaohongshu.com/user/profile/{userId}` |

Sidebar **发布** link also lands on the creator publish page.

## Workflow

Copy this checklist and track progress:

```
- [ ] 1. Verify Chrome debug + login
- [ ] 2. Open creator publish page
- [ ] 3. Switch to 上传图文
- [ ] 4. Upload images (as provided)
- [ ] 5. Validate title ≤20 / body ≤1000; fill + topics
- [ ] 6. Submit
- [ ] 7. Confirm success + capture note link
```

### 1. Verify Chrome

```bash
curl -s http://127.0.0.1:9222/json/version | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Browser','?'))"
```

Open `https://www.xiaohongshu.com/explore`. Snapshot must show **我** / **发布** (not a login wall).

### 2. Open publish page

```text
new_page → https://creator.xiaohongshu.com/publish/publish?source=official
```

Default tab is **上传视频**. Must switch to **上传图文**.

### 3. Switch to image-text mode

Click **上传图文** (twice in sidebar is normal). Wait for:

- `input[type=file]` with `accept` including `.jpg,.jpeg,.png,.webp`
- Copy hint: 「上传图片，或写文字生成图片」

If MCP `click` on tab text fails, use JS:

```javascript
(() => {
  const el = [...document.querySelectorAll('*')]
    .find(e => e.textContent?.trim() === '上传图文' && e.children.length === 0);
  (el?.closest('span, div, button') || el)?.click();
  return !!el;
})()
```

### 4. Upload images

Upload whatever images the user provides (creator UI allows up to **18** images). Do not invent a minimum count.

**Preferred:** run [scripts/upload-files.cdp.mjs](scripts/upload-files.cdp.mjs) — MCP `upload_file` often fails with workspace-root restrictions on WSL paths.

```bash
node scripts/upload-files.cdp.mjs \
  --page-url "creator.xiaohongshu.com/publish" \
  --files /path/to/01.jpg,/path/to/02.jpg
```

After upload, wait for editor UI: **填写标题**, body textbox, **发布** button. Snapshot should show `N/18` image count.

**Image prep:** If source images live under `/mnt/c/...`, copy into a short workspace path first (e.g. `~/xhs-assets/`) so CDP can read them.

### 5. Fill content

Before `fill`, check length:

1. Title length ≤ 20; if longer, shorten or ask the user.
2. Body length ≤ 1000 (including planned topics); if longer, shorten or ask.

| Field | MCP action | Notes |
|-------|------------|-------|
| Title | `fill` on placeholder 「填写标题会有更多赞哦」 | **≤ 20 chars** |
| Body | `fill` on `.tiptap.ProseMirror` / multiline textbox | Plain text first; **≤ 1000 chars** total |
| Topic | **Do not** prepend `#` manually in body | Use **话题** button instead |

**Topic workflow (important):**

1. Fill body **without** leading `#`.
2. Click **话题** button.
3. `type_text` the topic name.
4. Wait for suggestion tooltip; click the matching official tag.
5. Confirmed body shows `[话题]` marker and preview renders `#tag` separately.

Clicking **话题** before body is ready can inject a stray `#` at the start — rewrite body if that happens. Re-check the `N/1000` counter after adding topics.

Optional: scroll to **内容设置**; defaults (公开可见, 允许正文复制) are usually fine.

### 6. Submit

Click **发布**. Button shows **发布** busy/disabled while uploading.

Wait for:

- URL → `.../publish/success?...`, or
- Text **发布成功**

### 7. Verify + get link

1. **Note manager:** `https://creator.xiaohongshu.com/new/note-manager` — newest row, status 审核中/已发布.
2. **Profile:** open user profile from sidebar **我**; first note tile links to:
   `https://www.xiaohongshu.com/explore/{noteId}`

Return the explore link to the user.

## File upload

### Why CDP

`chrome-devtools` `upload_file` validates paths against Cursor workspace roots. Windows desktop paths (`/mnt/c/Users/...`) and sometimes `~/` paths are rejected. **CDP `DOM.setFileInputFiles`** uses absolute OS paths and works reliably.

### Script

[scripts/upload-files.cdp.mjs](scripts/upload-files.cdp.mjs):

- Finds page by `--page-url` substring in CDP target list.
- Locates first `input[type=file]` on the page.
- Sets files and triggers the site's change handler.

Run from repo skill dir or pass absolute script path.

### Manual CDP (Node one-liner pattern)

If the script is unavailable, use Node + WebSocket against `ws://127.0.0.1:9222/devtools/page/{id}`:

1. `GET http://127.0.0.1:9222/json/list` → match page URL.
2. `DOM.getDocument` → `DOM.querySelectorAll` `input[type=file]`.
3. `DOM.setFileInputFiles` with absolute file paths.

## Pitfalls

| Issue | Fix |
|-------|-----|
| Tab stuck on video upload | JS-click **上传图文** |
| `upload_file` access denied | Copy files + use CDP script |
| Title/body over limit | Trim to ≤20 / ≤1000 before fill |
| Topic prepends `#` to body | Rewrite body, use 话题 picker |
| Publish button stays busy | Wait up to 30s; check image upload finished |
| Note link not in creator UI | Open profile page; read first note href |

## Related skills

- **`chrome-debug`** — start/verify shared Chrome.

## Example

**Inputs:** user-provided images, title (≤20), body (≤1000), optional topics.

**Steps:** publish page → 上传图文 → CDP upload → validate lengths → title → body → 话题 (if any) → 发布 → copy explore link from profile.

**Output:** `https://www.xiaohongshu.com/explore/{noteId}`
