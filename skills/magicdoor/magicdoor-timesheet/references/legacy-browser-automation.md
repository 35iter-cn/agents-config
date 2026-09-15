# Legacy Browser Automation for Google Sheets (keyboard era reference)

Historical reference. The timesheet skill now uses the Sheets API (`cli/mdsheet`); this file preserves the hard-won browser keyboard techniques in case canvas-level scripting is ever needed again.

## Why keyboard-only

Google Sheets is a canvas app: grid content is not in the DOM. Multiline paste onto a selected-but-not-editing cell scatters text row-by-row (has destroyed a month before). The safe path is the cell **editor**, reached by trusted keyboard events, with focus asserted before every destructive key.

## Capability contract

The driver must provide: bring page to OS front (paste is silently dropped without focus); trusted key events incl. modifier combos; in-page JS evaluation; clipboard write (`navigator.clipboard.writeText`); ≥2 verification channels (formula-bar reads + screenshot; CSV export gets rate-limited — never sole channel).

## Per-cell algorithm (verified order)

1. Bring page to front.
2. Name-box jump (`#t-name-box`: focus, set value, Enter), read back — must equal target.
3. Enter opens the editor; assert `document.activeElement.id === 'waffle-rich-text-editor'`.
4. Clipboard: `printf '%s' "$(cat cell)" | xsel --clipboard --input` (DISPLAY=:0) — never atob/base64 in tool calls (see pitfalls).
5. Re-assert focus immediately before Ctrl+A → Ctrl+V.
6. Strict-compare editor text with on-disk expected file, gated by sha256; mismatch → retry once → STOP.
7. Enter commits; selection auto-advances down one cell (exploit for column runs).
Pilot rule: write ONE cell, read the cell below before batching.

## Editing-state detection

`#t-cell-editor` is unreliable (may be absent while editing). Ground truth = `activeElement.id === 'waffle-rich-text-editor'` AND `getBoundingClientRect().top > 150` (in-grid). Merely selected ⇒ editor parked at top ≈ `-9998`.

## Sheet open / create (browser)

Sheets home → find `Hao-YYYY/MM` → open and record `SHEET_ID` in project memory. No previous sheet → copy the most recent monthly sheet, rename, clear data rows, set the first DATE formula to the 1st. Layout detection: name-box to `B1`, walk down until formula bar reads `DATE`; map headers B..G.

## Pitfalls (keyboard era)

- `atob(b64)` returns a Latin-1 byte-string: `writeText(atob(...))` corrupts emoji/CJK while naive self-comparisons still pass. Decode: `new TextDecoder('utf-8').decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))`; gate pastes on sha256 matching the source file.
- Never hand-copy long base64 between tool calls (one-char typo corrupted a weekly cell; sha gate caught it).
- Formula-bar `textContent` drops newlines: verify by sha256 of the newline-stripped string.
- Concurrent Pi sessions steal OS focus between calls: typed name-box refs can land in the GRID as cell garbage. Pass explicit `pageId` (`list_pages` re-indexes), assert name-box value === target in the same evaluate gating Ctrl+A/Ctrl+V, audit neighbors after any ABORT.
- Commit-Enter moves selection DOWN one cell.
- CSV export: in-page fetch → `ACCESS_DENIED`; `/export?format=csv` → stalled download; gviz → needs OAuth. Audit via name-box + formula-bar reads.

## Recovery (scatter)

1. Stop writing.
2. File → Version history → Restore (fastest full fix).
3. Or walk the cells below via formula bar and clear stray text with the per-cell algorithm (grid Delete unreliable on multiline).
4. Re-write only via the per-cell algorithm.