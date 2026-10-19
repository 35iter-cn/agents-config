---
name: writing-skills
description: Use when creating, editing, or reviewing a skill or any always-loaded agent document (an AGENTS.md line, a docs pointer) — including when a skill does not fire when it should, when one has sprawled, or when a repeating practice may deserve a skill.
category: workflow
date_added: "2026-10-19"
---

# Writing Skills

## Overview

A skill is a **context pointer** plus the material behind it. The pointer (frontmatter) is always loaded and decides *when* the material is reached; the body decides whether the agent behaves correctly once it gets there. Both are written, and both are tested by running an agent on the task with and without them.

**Writing is eval-driven.** Watch an agent fail without the document, write the minimum that fixes that failure, re-run, then prune what did not bind. A document nobody tested is a guess about a default you never measured.

## Two budgets

- **Context load** — cost to the agent's window of anything always loaded: an `AGENTS.md` line, a skill description. Charged every turn whether it fires or not.
- **Cognitive load** — cost to the human of remembering which documents exist and when to reach for each. Not a cost to minimise; it is the price of human control. Spend it where human judgement matters.

Material reached through a pointer escapes context load at the price of the pointer's line. Material with no pointer rides entirely on cognitive load.

## Information hierarchy

Rank every piece by how immediately the agent needs it:

1. **In-file step** — what the agent does, in order. The primary tier.
2. **In-file reference** — consulted on demand; a flat peer-set of rules is a fine arrangement, not a smell.
3. **Disclosed reference** — pushed into a sibling file behind a pointer, loaded only when that pointer fires.

Push too little and the top bloats; push too much and you hide what the agent needs. **Progressive disclosure** is the move down the ladder, protecting the top rather than saving tokens. The cleanest test is branching: inline what every branch needs, disclose what only some branches reach.

**Co-location** is the companion rule: a concept's definition, rules and caveats live under one heading so reading one part brings its neighbours. **Sprawl** is the failure mode — a document too long even when every line is live; attention thins and every extra line must be kept relevant. Cure sprawl with the ladder, not with tighter prose.

Practical ceilings: keep `SKILL.md` under ~500 lines, keep references **one level deep** from it (agents preview nested files with `head` and miss the rest), and give any reference over ~100 lines a table of contents at the top.

## Step 1 — Decide if this is a skill

Create one when the technique was not obvious, you would reach for it again, and it applies beyond one project.

Take a different vehicle otherwise:

| Situation | Vehicle |
|---|---|
| One-off solution, obvious standard practice | nothing |
| Project-specific convention | the project's `AGENTS.md` |
| Enforceable by regex, validation or a hook | automate it; documentation is for judgement calls |
| Knowledge the agent needs only inside one repo task | a doc plus a pointer line, not a skill |

**Invocation choice decides the pointer's cost.** A model-invoked skill keeps a `description`, so the agent can fire it autonomously and other skills can reach it — permanent context load bought for discovery. A user-invoked skill (`disable-model-invocation: true` in pi) strips that: zero context load, but you become the index. Pick model-invocation only when the agent must reach it on its own or another skill must; if it only ever fires by hand, keep it user-invoked. When user-invoked skills pile up past what you can remember, add one **router skill** naming the others and when to reach for each.

## Step 2 — Watch it fail first (baseline)

Run the representative task with no guidance and record what the agent actually does and says, verbatim. What failed is the spec for what you write; without it you are documenting imagined gaps.

Cheap pre-check — if the no-guidance control already behaves, there is nothing to fix: stop, do not author the guidance.

| Skill type | What you test | Pass |
|---|---|---|
| Discipline (a rule it must not break) | pressure: time, sunk cost, authority, exhaustion; 3+ combined | follows the rule under maximum pressure |
| Technique (how-to) | application, variations, gaps | applies it to a new scenario |
| Pattern (mental model) | recognition, application, counter-examples | knows when it does **not** apply |
| Reference (docs, APIs) | retrieval, application, gap coverage | finds and uses the right entry |

For a behaviour-shaping line of wording, micro-test before full scenarios: one fresh context per sample, a **no-guidance control arm**, 5+ reps per variant, and read every flagged match by hand (template echoes and quoted counter-examples score as false hits). Five different interpretations across five reps means the wording is not binding — tighten the form before adding words. Variance is the metric, not the average.

## Step 3 — Write the minimum (green)

Frontmatter:

- `name`: lowercase letters, numbers, hyphens, ≤64 chars, matching the directory.
- `description`: one clause on what it is, then the **trigger branches** — the distinct cases that send an agent here, in the words a user or agent would already be thinking (error text, symptoms, tool names). Keep well under 1024 chars, third person.
- **The description trap:** never summarise the skill's process or workflow here. An agent that reads "review between tasks" skips the body and does one review instead of the flowchart's two. Triggers only; the body carries the procedure.

Body skeleton, keeping only the sections that earn their place:

```markdown
## Overview        core idea in 1-2 sentences
## When to Use    symptoms, situations, and when NOT to
## Quick Reference table or bullets for scanning
## Workflow        ordered steps; link out heavy or reusable detail
## Common Mistakes what goes wrong + the fix
```

Drafting levers:

- **Match freedom to fragility.** Many valid approaches → direction only. A preferred pattern → pseudocode or a parameterised script. Fragile, must-be-exact operations (migrations, deploys) → the exact command, with "do not add flags".
- **Leading words.** One pretrained token the agent thinks with (`red`, `tight`, `seam`, `tracer bullet`) anchors a region of behaviour for the price of a word. Prefer an existing word; a coined one pays its definition in tokens. Hunt restatements that a single leading word retires.
- **Positive framing.** State the target behaviour ("write one-line comments") rather than the ban: negation drags the forbidden behaviour into context and makes it more available, not less. A prohibition earns its place only as a hard guardrail that cannot be phrased positively — and then pair it with the positive target.
- **Steps end on a completion criterion** that is both checkable and exhaustive ("every modified model accounted for", "the loop goes red on the bug"). A vague bound invites **premature completion**; sharpen the bound first, and only if it stays irreducibly fuzzy hide the later steps — which only works across a real context boundary (hand-off, subagent), never an inline call.
- **One excellent example** beats many mediocre ones. No multi-language versions, no fill-in-the-blank scaffolds.
- **Templates:** state whether the shape is fixed ("use exactly this structure") or a default to adapt. Never both.
- **Feedback loops** for quality-critical output: validate → fix → re-validate, and say what "passes". For batch or destructive work, emit a plan file, validate it, then execute.
- **Scripts solve, they do not punt.** Handle the error the agent would otherwise have to improvise around; justify every constant. Say whether a script is *executed* ("run `scripts/x.sh`") or *read as reference*.
- Consistent terminology: one word per concept. Forward slashes in paths. No time-sensitive statements — park superseded guidance in an "old patterns" section.

## Step 4 — Match the form to the failure

The form that bulletproofs one failure type measurably backfires on another. Classify the baseline failure first.

| Baseline failure | Right form | Wrong form |
|---|---|---|
| Knows the rule and skips it under pressure | prohibition + rationalization table + red flags | soft guidance ("prefer", "consider") |
| Complies but the output has the wrong shape | positive recipe or contract: what the output *is*, its parts in order | a list of things not to write |
| Omits a required element it already produces | a REQUIRED slot in the template it fills | prose reminders beside the template |
| Behaviour depends on a condition | conditional keyed to an observable predicate | unconditional rule plus exemption clauses |

Two rules for whichever form you pick: **no nuance clauses** ("don't X unless it matters" reopens the negotiation — express the real exception as its own conditional on a predicate), and **exemption clauses do not scope** ("this limit does not apply to code blocks" still suppresses code blocks — restructure so the rule cannot reach them).

For the discipline row, make the counters explicit and exhaustive:

- Foundational line early: *violating the letter of the rules is violating the spirit of the rules.* This removes a whole class of "I followed the intent" arguments.
- Forbid the specific workaround, not just the act: "delete it, start over — do not keep it as reference, do not adapt it while writing tests, delete means delete."
- **Rationalization table**: every excuse from the baseline run in one column, the reality beside it.
- **Red flags list**: the sentences the agent says right before violating, ending with "all of these mean: start over."

## Step 5 — Re-test and prune (refactor)

Re-run the same scenarios with the document loaded; then run new pressures and add counters for whatever new rationalization appears. Then prune, because the first draft always carries sediment:

- **Single source of truth** per meaning. Duplication costs maintenance and inflates a meaning's rank. (A leading word repeats a *token* on purpose; duplication repeats a *meaning*.)
- **Cache only expensive lookups.** Restating `package.json` scripts, config or `--help` output is a cache that goes stale; capture the unwritten convention, the reason behind a choice, the gotcha no config confesses.
- **Delete no-ops sentence by sentence**: does this change behaviour versus the default? If not, delete the whole sentence rather than trim words from it. The test is model-relative — settle disagreements by running the document, not by debate.
- **Relevance**: does the line still bear on what the document does? Shorter documents are easier to keep relevant; without this pass the default fate is **sediment** — stale layers that settle because adding feels safe and removing feels risky.

## Checklist

- [ ] Baseline failure observed and recorded, or the no-guidance control already passed (stop)
- [ ] Name and description legal; description carries triggers and no workflow summary
- [ ] Body fixes that specific failure, in the form matched to it
- [ ] Steps end on checkable, exhaustive completion criteria
- [ ] Every branch the agent needs inline; everything else disclosed one level deep
- [ ] Guidance micro-tested for wording variance; scenarios re-run with the document loaded
- [ ] Tested on each model you plan to use it with
- [ ] Rationalization table and red flags present for discipline skills
- [ ] Prune pass done: no duplication, no restated environment, no no-ops
- [ ] Landed at `~/code/agents-config/skills/<bucket>/<name>/SKILL.md`, then `scripts/sync-skills.mjs`

## Anti-patterns

- A narrative of how you solved it once, instead of a reusable technique.
- A description that summarises the workflow, so the body never gets read.
- Prohibitions where the failure was output shape.
- Deep reference nesting, or files named `doc2.md`.
- Writing several skills in one pass without verifying each.
- Restating what the agent already knows ("a PDF contains text") to look thorough.

## Sources

- obra/superpowers — `skills/writing-skills` (Iron Law, SDO, form-to-failure, rationalization tables)
- mattpocock/skills — `writing-for-agents` and `SKILL-MECHANICS` (context pointers, two loads, hierarchy, leading words, negation, pruning)
- Anthropic — Skill authoring best practices (degrees of freedom, eval-first, disclosure patterns, scripts)
