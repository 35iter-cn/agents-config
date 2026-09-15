---
name: xiaohongshu-publish
description: Use when the user asks to post or publish on 小红书/Xiaohongshu, automate Xiaohongshu creator workflows, or edit an already-published note. Triggers include opening the creator center, uploading or generating images, filling title/body, adding topics, and verifying note links. Also use when user has no images — text-to-image (文生图/文字配图) is the default path.
---

# Xiaohongshu Publish

Publish **image-text notes** on Xiaohongshu through the web creator center, using `chrome-devtools` MCP on the shared debug Chrome instance.

## When to Use

- User asks to open/publish on 小红书 or Xiaohongshu.
- User wants to post an image-text note with optional topics.
- User asks to automate note creation after drafting copy elsewhere.
- User wants to edit an already-published note (creator `update` page).
- User provides **no images** → go **文生图 (文字配图)** by default. Do NOT ask; the creator center generates an image from your copy.

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

Count Chinese characters, Latin letters, digits, and punctuation the same way the creator UI does (one code point ≈ one counter unit). **Hashtags written directly in the body count toward the 1000 limit.**

## Prerequisites

1. **`shared-chrome` skill** — shared Chrome on `http://127.0.0.1:9222`. WSL: start with `--dbus-stub` or Chrome crashes with `FATAL:dbus/bus.cc:1245`.
2. **`chrome-devtools` MCP** — `new_page`, `navigate_page`, `take_snapshot`, `fill`, `click`, `type_text`, `evaluate_script`.
3. **Logged-in Xiaohongshu account** in that Chrome profile.
4. **Images on disk** (only if the user provided them) — see [File upload](#file-upload).

## URLs

| Step | URL |
|------|-----|
| Home (logged in) | `https://www.xiaohongshu.com/explore` |
| Creator publish | `https://creator.xiaohongshu.com/publish/publish?source=official` |
| Edit published note | `https://creator.xiaohongshu.com/publish/update?source=official&id={noteId}&noteType=normal` |
| Note manager | `https://creator.xiaohongshu.com/new/note-manager` |
| User profile | `https://www.xiaohongshu.com/user/profile/{userId}` |

`noteId` is a 24-char hex string (e.g. `6a7be3d700000000330326c1`) taken from any explore/update/note-manager link. After editing, the note must be re-published (点发布) for changes to take effect.

Sidebar **发布** link also lands on the creator publish page.

## Workflow

Copy this checklist and track progress:

```
- [ ] 1. Verify Chrome debug + login
- [ ] 2. Open creator publish page
- [ ] 3. Switch to 上传图文
- [ ] 4. Images: CDP upload if provided, else 文生图 generate
- [ ] 5. Fill title ≤20 / body ≤1000 with hashtags inline
- [ ] 6. Submit
- [ ] 7. Confirm success + capture note link
```

### 1. Verify Chrome

```bash
curl -s http://127.0.0.1:9222/json/version | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Browser','?'))"
```

Open `https://www.xiaohongshu.com/explore`. Snapshot must show **我** / **发布** (not a login wall). If Chrome keeps crashing, restart with `--dbus-stub`.

### 2. Open publish page

```text
new_page → https://creator.xiaohongshu.com/publish/publish?source=official
```

Default tab is **上传视频**. Must switch to **上传图文**.

### 3. Switch to image-text mode

Click **上传图文** (twice in sidebar is normal). Wait for:

- `input[type=file]` with `accept` including `.jpg,.jpeg,.png,.webp`
- Copy hint: 「上传图片，或写文字生成图片」

If MCP `click` on tab text fails (element "did not become interactive"), use JS:

```javascript
(() => {
  const el = [...document.querySelectorAll('*')]
    .find(e => e.textContent?.trim() === '上传图文' && e.children.length === 0);
  (el?.closest('span, div, button') || el)?.click();
  return !!el;
})()
```

### 4. Images — upload or 文生图 (default when no images)

**User provided images?** Use CDP upload below. **No images?** Go 文生图 — do not ask.

**文生图 path (文字配图):**

1. In the image-text upload area, click the **文字配图** button (next to 上传图片).
2. Fill the copy box with a poster-style caption: one punchy headline line, key numbers, a benefit line (see [note-layout-rules.md](note-layout-rules.md)).
3. Click **生成图片**.
4. Wait for generated images (candidates load from `zeusengine-gpu-server` URLs; no spinner). Confirm via `evaluate_script` reading `img` srcs.
5. Click **下一步** — no candidate picking needed; the generated image lands in the note editor (shows `1/18`), no local files involved.

**CDP upload path (user-provided images):** run [scripts/upload-files.cdp.mjs](scripts/upload-files.cdp.mjs) — MCP `upload_file` often fails with workspace-root restrictions on WSL paths.

```bash
node scripts/upload-files.cdp.mjs \
  --page-url "creator.xiaohongshu.com/publish" \
  --files /path/to/01.jpg,/path/to/02.jpg
```

**Image prep:** If source images live under `/mnt/c/...`, copy into a short workspace path first (e.g. `~/xhs-assets/`) so CDP can read them.

After upload/generation, wait for editor UI: **填写标题**, body textbox, **发布** button.

### 5. Fill content

Before filling, check length: title ≤ 20, body ≤ 1000 (including hashtags).

**Title:** `fill` on placeholder 「填写标题会有更多赞哦」.

**Body — multi-paragraph layout (critical):** `fill` **folds `\n` into spaces** and collapses all paragraphs into one. Use `execCommand('insertText')` instead:

```javascript
// 1) clear: focus + selectAll + insertText('')
// 2) wait ~150ms, then insert paragraphs joined by \n (single newline = paragraph break)
// 3) for blank-line spacing between paragraphs, join by \n\n — must be a SEPARATE call after the clear (same-sync selectAll+insertText races and drops content)
```

Confirm paragraph count via `evaluate_script`: `document.querySelectorAll('.tiptap p').length` should equal content paragraphs (+ blank ones). See [note-layout-rules.md](note-layout-rules.md) for the layout recipe.

**Topics — inline hashtags, NOT the picker:**

- Write `#话题1 #话题2 …` directly at the end of the body, space-separated. 3–6 tags: core keyword + traffic keywords.
- **Do NOT open the 话题 picker.** It injects a stray `#` into the body start, its search box is hard to target (hidden 4px filter inputs vs 62px search input; width heuristics can hit the title box and corrupt the title), and the open panel hides the 发布 button.

Optional: scroll to **内容设置**; defaults (公开可见, 允许正文复制) are usually fine.

### 6. Submit

Click **发布** (button may show busy/disabled while uploading). If the button is not found in the DOM, the topic panel may still be open — close it (Esc), re-snapshot, and click by uid.

Wait for:

- URL → `.../published=true` or navigation to note manager, or
- Text **发布成功**

### 7. Verify + get link

1. **Note manager:** `https://creator.xiaohongshu.com/new/note-manager` — newest row, status 审核中/已发布.
2. Note id = 24-char hex; explore link is `https://www.xiaohongshu.com/explore/{noteId}`.

Return the explore link to the user.

## Editing an already-published note

- Open `https://creator.xiaohongshu.com/publish/update?source=official&id={noteId}&noteType=normal`.
- The update page opens directly in edit state — no need to switch the 上传图文 tab.
- Title/body are editable; images and existing hashtags are preserved.
- After edits, click **发布** to re-publish (the edit is not saved otherwise).
- Safer than republishing: revert is possible while the note stays live.

## File upload

### Why CDP

`chrome-devtools` `upload_file` validates paths against workspace roots. Windows desktop paths (`/mnt/c/Users/...`) and sometimes `~/` paths are rejected. **CDP `DOM.setFileInputFiles`** uses absolute OS paths and works reliably.

### Script

[scripts/upload-files.cdp.mjs](scripts/upload-files.cdp.mjs):

- Finds page by `--page-url` substring in CDP target list.
- Locates first `input[type=file]` on the page.
- Sets files and triggers the site's change handler.

### Manual CDP (Node one-liner pattern)

If the script is unavailable, use Node + WebSocket against `ws://127.0.0.1:9222/devtools/page/{id}`:

1. `GET http://127.0.0.1:9222/json/list` → match page URL.
2. `DOM.getDocument` → `DOM.querySelectorAll` `input[type=file]`.
3. `DOM.setFileInputFiles` with absolute file paths.

## Pitfalls

| Issue | Fix |
|-------|-----|
| Chrome crashes on WSL (`FATAL:dbus/bus.cc:1245`) | Restart debug Chrome with `--dbus-stub` |
| Tab stuck on video upload | JS-click **上传图文** |
| `upload_file` access denied | Copy files + use CDP script |
| Title/body over limit | Trim to ≤20 / ≤1000 before fill |
| `fill` collapses multi-paragraph body into one block | Use `execCommand('insertText')` with `\n` paragraph breaks (see §5) |
| Topic picker injects `#` at body start / search box targets wrong input / panel hides 发布 | Don't open the picker — write hashtags inline at body end |
| Title got corrupted while scripting inputs | Width-heuristic selectors can match the title box; scope selectors to the panel/container |
| Publish button "missing" from DOM | Topic panel overlay; Esc, re-snapshot, click by uid |
| `evaluate_script` syntax error on newlines | Write `\\n` in the JS string (JSON `\n` becomes a literal newline in the function body) |
| Publish button stays busy | Wait up to 30s; check image upload finished |
| Note link not in creator UI | Extract 24-char hex id from any explore/update link |

## Related skills

- **`shared-chrome`** — start/verify shared Chrome.
- **`note-layout-rules.md`** — reusable layout recipe (paragraphs, icons, hashtags) abstracted from a real published note.

## Example

**Inputs:** user-provided images OR none (文生图 default), title (≤20), body (≤1000, inline hashtags).

**Steps:** publish page → 上传图文 → 文生图 or CDP upload → execCommand multi-paragraph body → inline hashtags → 发布 → verify in note manager.

**Output:** `https://www.xiaohongshu.com/explore/{noteId}`
