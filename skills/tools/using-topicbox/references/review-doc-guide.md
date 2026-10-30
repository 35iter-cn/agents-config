# Review Document Guide

When the user asks for a review document — a Lark/Feishu doc they will read and decide from — it is a **view of the spec**, not a second spec: everything in it comes from the spec, and it adds only what a reviewer cannot reconstruct by reading prose.

## Hard gate before delivery

Neither is optional: when one is missing, say which instead of sending the document without it.

| Requirement | Applies when | Satisfied by |
|---|---|---|
| Prototype sketch | the change is visible in a UI | one sketch per changed surface, plus one per new dialog or panel |
| Conformance table | the spec has a conformance section | that table copied with its `C-n` ids and citations intact, plus the scan line |

When a requirement does not apply, write that in one line in the document — `No UI change in this spec, so no prototype sketch`. A missing section and a not-applicable section read the same to a reviewer.

## Prototype sketch

**Visible** means a user can see a difference: a new button, a moved control, changed copy, spacing, an empty or error state. Copy-only and style-only changes count — they need a smaller sketch, not no sketch.

**Form is yours to choose.** Wireframe, annotated screenshot, box layout — no mandated tool and no fixed template. Colour, radius and button size come from the component library; the sketch fixes interaction and placement, not pixels. A flow diagram (mermaid sequence or flowchart) explains behaviour and is not a sketch of a screen, so it does not cover this requirement on its own.

Keep the source image under the topic's `assets/`, referenced from the spec: the document is the reviewer's copy, the topic is the recoverable one.

## Conformance in the document

Copy the spec's table as it stands — same ids, citations, dispositions and scan line; the way to change it is to change the spec first.

Then mark which violations survive the design:

| Fill | Meaning |
|---|---|
| red (`background-color="light-red"`) | the design still violates the convention when it ships — `Accepted here`, `Out of scope`, or a violation with no disposition yet |
| none | `Fixed here` (this change resolves it) or `No violation` |

Put one legend line above the table; a reader should not have to infer what the colour means.

Mechanics, verified 2026-10-30 on lark-cli 1.0.97:

- Lark tables have no row-level fill. Set `background-color="light-red"` on **every** `<td>` of the row (`rgb(254,241,241)`). `background-color="red"` is silently dropped by the server for table cells.
- Verify by re-fetching with `docs +fetch --detail full`. The default `simple` detail omits cell colours, so concluding "no colour" from it is wrong.

## Revising

The document stays editable until the user confirms. A decision changes the spec's dispositions first; re-mark this document in the same pass. A red row that outlives the decision that removed the violation is a lie told in colour.
