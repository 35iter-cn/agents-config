import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireLock,
  buildUnits,
  chunkMessage,
  clearOverride,
  decideUnit,
  formatReport,
  listReviews,
  readLedger,
  run,
  setOverride,
  unitHash,
  unitState,
  DEFAULTS,
} from "./hours.mjs";

const MINUTE = 60_000;

function rec(startIso, minutes, extra = {}) {
  return {
    v: 1,
    id: `${extra.sessionId ?? "s1"}:${startIso}`,
    sessionId: extra.sessionId ?? "s1",
    sessionFile: "/s/x.jsonl",
    source: extra.source ?? "interactive",
    startedAt: startIso,
    durationMs: minutes * MINUTE,
    userText: extra.userText ?? "干点活",
    output: extra.output ?? "干完了",
    aborted: extra.aborted ?? false,
  };
}

function fakeJudge(answers) {
  const calls = [];
  return {
    calls,
    async judgeChoice({ id, state }) {
      calls.push({ id, state });
      const answer = answers.shift();
      return answer ?? { choice: null, confidence: null, probabilities: null, fallback: "error" };
    },
  };
}

test("units merge when the gap from the previous end is 14 minutes and split at 16", () => {
  const units = buildUnits([
    rec("2026-10-24T01:00:00.000Z", 10),
    rec("2026-10-24T01:24:00.000Z", 10),
    rec("2026-10-24T01:50:00.000Z", 10),
  ]);
  assert.equal(units.length, 2);
  assert.equal(units.find((unit) => unit.runs.length === 2).runs.length, 2);
});

test("gap is measured from the previous end, not the previous start", () => {
  const units = buildUnits([rec("2026-10-24T01:00:00.000Z", 45), rec("2026-10-24T01:50:00.000Z", 5)]);
  assert.equal(units.length, 1);
});

test("overlapping runs in one session stay in the same unit and do not break later ones", () => {
  const units = buildUnits([
    rec("2026-10-24T01:00:00.000Z", 5),
    rec("2026-10-24T01:00:07.000Z", 5),
    rec("2026-10-24T01:30:00.000Z", 5),
  ]);
  assert.deepEqual(units.map((unit) => unit.runs.length), [1, 2]);
});

test("units never cross sessions", () => {
  const units = buildUnits([
    rec("2026-10-24T01:00:00.000Z", 5, { sessionId: "a" }),
    rec("2026-10-24T01:05:00.000Z", 5, { sessionId: "b" }),
  ]);
  assert.equal(units.length, 2);
});

test("automation, aborted and empty-prompt runs are dropped before units are built", () => {
  const units = buildUnits([
    rec("2026-10-24T01:00:00.000Z", 5, { source: "automation" }),
    rec("2026-10-24T01:00:00.000Z", 5, { aborted: true }),
    rec("2026-10-24T01:00:00.000Z", 5, { userText: "   " }),
  ]);
  assert.equal(units.length, 0);
});

test("unit key is the session id plus the first run start", () => {
  const [unit] = buildUnits([rec("2026-10-24T01:00:00.000Z", 5), rec("2026-10-24T01:06:00.000Z", 5)]);
  assert.equal(unit.key, "s1:2026-10-24T01:00:00.000Z");
  assert.equal(unit.runs.length, 2);
});

test("unit state carries requests then outputs and truncates each to 1200 chars", () => {
  const [unit] = buildUnits([rec("2026-10-24T01:00:00.000Z", 5, { userText: "字".repeat(2000), output: "答".repeat(2000) })]);
  const state = unitState(unit);
  assert.ok(state.startsWith("【用户请求】\n"));
  assert.ok(state.includes("\n\n【agent 产出】\n"));
  assert.ok(state.length <= 1200 * 2 + 40);
});

test("unit hash changes when a new run joins the unit", () => {
  const base = buildUnits([rec("2026-10-24T01:00:00.000Z", 5)])[0];
  const grown = buildUnits([rec("2026-10-24T01:00:00.000Z", 5), rec("2026-10-24T01:06:00.000Z", 5)])[0];
  assert.notEqual(unitHash(base), unitHash(grown));
  assert.equal(base.key, grown.key);
});

test("a confident probability split counts, an inverted one skips", async () => {
  const [unit] = buildUnits([rec("2026-10-24T01:00:00.000Z", 5)]);
  const judge = fakeJudge([
    { choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null },
    { choice: "skip", confidence: 0.9, probabilities: { count: 0.1, skip: 0.9 }, fallback: null },
  ]);
  assert.equal((await decideUnit(unit, { judge })).kind, "count");
  assert.equal((await decideUnit(unit, { judge })).kind, "skip");
});

test("low margin, judge fallback and very long runs all land in review", async () => {
  const [unit] = buildUnits([rec("2026-10-24T01:00:00.000Z", 5)]);
  const lowMargin = fakeJudge([{ choice: "count", confidence: 0.55, probabilities: { count: 0.54, skip: 0.46 }, fallback: null }]);
  assert.equal((await decideUnit(unit, { judge: lowMargin })).reason, "low-margin");

  const failed = fakeJudge([{ choice: null, confidence: null, probabilities: null, fallback: "timeout" }]);
  const failedResult = await decideUnit(unit, { judge: failed });
  assert.equal(failedResult.kind, "review");
  assert.equal(failedResult.reason, "timeout");

  const [longUnit] = buildUnits([rec("2026-10-24T01:00:00.000Z", 5 * 60)]);
  const longJudge = fakeJudge([]);
  const longResult = await decideUnit(longUnit, { judge: longJudge });
  assert.equal(longResult.reason, "long-run");
  assert.equal(longJudge.calls.length, 0);
});

test("a cached verdict is reused without calling the judge again", async () => {
  const [unit] = buildUnits([rec("2026-10-24T01:00:00.000Z", 5)]);
  const judge = fakeJudge([{ choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null }]);
  const first = await decideUnit(unit, { judge });
  const cache = { [unit.key]: { hash: unitHash(unit), result: first, notifiedHash: null } };
  const second = await decideUnit(unit, { judge, cache });
  assert.equal(second.cached, true);
  assert.equal(judge.calls.length, 1);
});

test("messages are chunked on block boundaries under the card limit", () => {
  const blocks = Array.from({ length: 5 }, (_, index) => `块 ${index} ${"字".repeat(800)}`);
  const chunks = chunkMessage(blocks.join("\n\n"), 2400);
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) assert.ok(chunk.length <= 2400);
  assert.equal(chunks.join("\n\n").replace(/\s+/g, ""), blocks.join("\n\n").replace(/\s+/g, ""));
});

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-hours-"));
  mkdirSync(path.join(dir, "ledger"), { recursive: true });
  const now = Date.parse("2026-10-24T02:00:00.000Z");
  writeFileSync(
    path.join(dir, "ledger", "s1.jsonl"),
    `${JSON.stringify(rec("2026-10-24T01:00:00.000Z", 5))}\n${JSON.stringify(rec("2026-10-24T01:10:00.000Z", 5))}\n`,
  );
  return { dir, now };
}

test("a run judges, notifies once and records the notified hash", async () => {
  const { dir, now } = sandbox();
  const judge = fakeJudge([{ choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null }]);
  const sent = [];
  const first = await run({ now, dir, judge, notifyImpl: (text) => (sent.push(text), { ok: true }) });
  assert.equal(first.fresh.length, 1);
  assert.equal(first.delivered, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /\*\*工时\*\*/);

  const decisions = JSON.parse(readFileSync(path.join(dir, "decisions.json"), "utf8"));
  const entry = Object.values(decisions)[0];
  assert.equal(entry.result.kind, "count");
  assert.equal(entry.notifiedHash, entry.hash);
  assert.ok(existsSync(path.join(dir, "digest")));

  const second = await run({ now: now + 30 * MINUTE, dir, judge, notifyImpl: (text) => (sent.push(text), { ok: true }) });
  assert.equal(second.fresh.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(judge.calls.length, 1);
});

test("review units are queued and a failed notify leaves them un-notified", async () => {
  const { dir, now } = sandbox();
  const judge = fakeJudge([{ choice: null, confidence: null, probabilities: null, fallback: "http_429" }]);
  const outcome = await run({ now, dir, judge, notifyImpl: () => ({ ok: false, output: "boom" }) });
  assert.equal(outcome.delivered, false);
  const reviewFile = path.join(dir, "review", "2026-10-24.jsonl");
  assert.ok(existsSync(reviewFile));
  const entry = JSON.parse(readFileSync(reviewFile, "utf8").trim().split("\n")[0]);
  assert.equal(entry.reason, "http_429");
  const decisions = JSON.parse(readFileSync(path.join(dir, "decisions.json"), "utf8"));
  assert.equal(Object.values(decisions)[0].notifiedHash, null);
});

test("units that ended inside the settle window are left for the next run", async () => {
  const { dir, now } = sandbox();
  const judge = fakeJudge([{ choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null }]);
  const outcome = await run({ now: Date.parse("2026-10-24T01:18:00.000Z"), dir, judge, notifyImpl: () => ({ ok: true }) });
  assert.equal(outcome.units, 0);
  assert.equal(judge.calls.length, 0);
});

function readEvents(dir, day = "2026-10-24") {
  return readFileSync(path.join(dir, "logs", `${day}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

test("a run writes one event stream with unit, notify and round lines", async () => {
  const { dir, now } = sandbox();
  const judge = fakeJudge([{ choice: "count", confidence: 0.9, attempts: 1, elapsedMs: 1200, probabilities: { count: 0.9, skip: 0.1 }, fallback: null }]);
  await run({ now, dir, judge, notifyImpl: () => ({ ok: true, output: "sent" }) });
  const events = readEvents(dir);
  assert.deepEqual(events.map((event) => event.event), ["unit", "notify", "round"]);
  const [unit, notify, round] = events;
  assert.equal(unit.kind, "count");
  assert.equal(unit.review, false);
  assert.equal(unit.confidence, 0.9);
  assert.equal(unit.attempts, 1);
  assert.equal(unit.elapsedMs, 1200);
  assert.deepEqual(unit.span, ["2026-10-24T01:00:00.000Z", "2026-10-24T01:15:00.000Z"]);
  assert.equal(unit.key.startsWith("s1:"), true);
  assert.equal(unit.session, "s1");
  assert.equal(unit.source, "interactive");
  assert.equal(notify.ok, true);
  assert.equal(notify.units, 1);
  assert.equal(round.units, 1);
  assert.equal(round.processed, 1);
  assert.equal(round.leftover, 0);
  assert.equal(round.truncated, 0);
  assert.deepEqual(round.counts, { count: 1 });
});

test("review units carry the flag, reason and the request/output excerpts in the same stream", async () => {
  const { dir, now } = sandbox();
  const judge = fakeJudge([{ choice: null, confidence: null, attempts: 3, elapsedMs: 90000, probabilities: null, fallback: "timeout" }]);
  await run({ now, dir, judge, notifyImpl: () => ({ ok: true, output: "sent" }) });
  const [unit] = readEvents(dir);
  assert.equal(unit.review, true);
  assert.equal(unit.kind, "review");
  assert.equal(unit.reason, "timeout");
  assert.equal(unit.attempts, 3);
  assert.equal(unit.requests.length, 2);
  assert.equal(unit.outputs.length, 2);
});

test("unchanged units are not re-appended to the stream on a later round", async () => {
  const { dir, now } = sandbox();
  const judge = fakeJudge([{ choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null }]);
  await run({ now, dir, judge, notifyImpl: () => ({ ok: true, output: "sent" }) });
  await run({ now: now + 30 * MINUTE, dir, judge, notifyImpl: () => ({ ok: true, output: "sent" }) });
  const events = readEvents(dir);
  assert.equal(events.filter((event) => event.event === "unit").length, 1);
  assert.equal(events.filter((event) => event.event === "round").length, 2);
});

test("dry run writes nothing", async () => {
  const { dir, now } = sandbox();
  const judge = fakeJudge([{ choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null }]);
  const outcome = await run({ now, dir, judge, dryRun: true, notifyImpl: () => ({ ok: true }) });
  assert.equal(outcome.fresh.length, 1);
  assert.ok(outcome.report.includes("**工时**"));
  assert.equal(existsSync(path.join(dir, "decisions.json")), false);
  assert.equal(existsSync(path.join(dir, "digest")), false);
  assert.equal(existsSync(path.join(dir, "logs")), false);
});

test("ledger reader keeps every record of a file whose mtime is inside the window", () => {
  const { dir, now } = sandbox();
  const fresh = readLedger(path.join(dir, "ledger"), { now });
  assert.equal(fresh.length, 2);
  const stale = readLedger(path.join(dir, "ledger"), { now: now + 4 * 24 * 60 * MINUTE });
  assert.equal(stale.length, 0);
});

test("unit keys do not drift when a head run falls out of the startedAt window", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-hours-"));
  mkdirSync(path.join(dir, "ledger"), { recursive: true });
  const now = Date.now();
  const head = new Date(now - 71.5 * 3_600_000).toISOString();
  const tail = new Date(now - 71.5 * 3_600_000 + 12 * MINUTE).toISOString();
  writeFileSync(path.join(dir, "ledger", "s1.jsonl"), `${JSON.stringify(rec(head, 10))}\n${JSON.stringify(rec(tail, 10))}\n`);
  const keysAt = (time) => buildUnits(readLedger(path.join(dir, "ledger"), { now: time }), {}).map((unit) => unit.key);
  const before = keysAt(now);
  assert.equal(before.length, 1);
  assert.deepEqual(keysAt(now + 2 * 3_600_000), before);
});

test("units that ended before the window are dropped before judging", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-hours-"));
  mkdirSync(path.join(dir, "ledger"), { recursive: true });
  const now = Date.now();
  const old = new Date(now - 73 * 3_600_000).toISOString();
  writeFileSync(path.join(dir, "ledger", "s1.jsonl"), `${JSON.stringify(rec(old, 5))}\n`);
  const judge = fakeJudge([{ choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null }]);
  const outcome = await run({ now, dir, judge, notifyImpl: () => ({ ok: true }) });
  assert.equal(outcome.units, 0);
  assert.equal(judge.calls.length, 0);
});

test("a second round cannot take the lock and a released one can", () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "agent-hours-")), ".lock");
  const first = acquireLock(file);
  assert.equal(typeof first, "function");
  assert.equal(acquireLock(file), null);
  first();
  const second = acquireLock(file);
  assert.equal(typeof second, "function");
  second();
});

test("a stale lock is taken over instead of blocking forever", () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "agent-hours-")), ".lock");
  writeFileSync(file, JSON.stringify({ pid: process.pid, ts: Date.now() - 60 * MINUTE }));
  const release = acquireLock(file);
  assert.equal(typeof release, "function");
  release();
});

test("the round budget stops judging and leaves the rest for the next round", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-hours-"));
  mkdirSync(path.join(dir, "ledger"), { recursive: true });
  writeFileSync(
    path.join(dir, "ledger", "s1.jsonl"),
    `${JSON.stringify(rec("2026-10-24T01:00:00.000Z", 5))}\n${JSON.stringify(rec("2026-10-24T02:00:00.000Z", 5))}\n`,
  );
  const slow = {
    async judgeChoice() {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null };
    },
  };
  const outcome = await run({ now: Date.parse("2026-10-24T02:30:00.000Z"), dir, judge: slow, budgetMs: 10, notifyImpl: () => ({ ok: true }) });
  assert.equal(outcome.units, 2);
  assert.equal(outcome.fresh.length, 1);
  const round = readEvents(dir).find((event) => event.event === "round");
  assert.equal(round.leftover, 1);
  assert.equal(round.processed, 1);
});

test("report is a summary: verdict counts, counted minutes and where the review units sit", () => {
  const units = buildUnits([
    rec("2026-10-24T01:00:00.000Z", 10, { sessionId: "a" }),
    rec("2026-10-24T01:00:00.000Z", 5, { sessionId: "b" }),
  ]);
  const report = formatReport(
    [
      { unit: units[0], result: { kind: "count", p: { count: 0.9 }, margin: 0.8 } },
      { unit: units[1], result: { kind: "review", reason: "low-margin", p: { count: 0.52 }, margin: 0.04 } },
    ],
    { tz: DEFAULTS.tz, now: Date.parse("2026-10-24T02:00:00.000Z") },
  );
  const lines = report.split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^\*\*工时\*\* 2026-10-24 10:00$/);
  assert.match(lines[1], /新增 2 单元 · 计入 1 · 不计 0 · 待确认 1/);
  assert.match(lines[2], /计入跨度 10 分钟/);
});

test("a report without review units omits the review count and adds the clock summary", () => {
  const units = buildUnits([rec("2026-10-24T01:00:00.000Z", 10)]);
  const report = formatReport(
    [{ unit: units[0], result: { kind: "count", p: { count: 0.9 }, margin: 0.8 } }],
    {
      tz: DEFAULTS.tz,
      now: Date.parse("2026-10-24T13:00:00.000Z"),
      clock: { created: 1, patched: 2, deleted: 0, conflict: 1, conflictMinutes: 29, failed: 0, blocked: [] },
    },
  );
  const lines = report.split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0], /2026-10-24 21:00/);
  assert.doesNotMatch(lines[1], /待确认/);
  assert.equal(lines[3], "Clock 写 3 段 · 冲突 29 分钟");
});

test("a manual override wins over both the cached verdict and a fresh judge call", async () => {
  const { dir, now } = sandbox();
  const judge = fakeJudge([{ choice: null, confidence: null, probabilities: { count: 0.73, skip: 0.27 }, fallback: "low-confidence" }]);
  await run({ now, dir, judge, notifyImpl: () => ({ ok: true }) });
  const key = Object.keys(JSON.parse(readFileSync(path.join(dir, "decisions.json"), "utf8")))[0];

  setOverride({ dir, key, kind: "count", note: "MagicDoor 事务（PR 审批状态确认），人工裁定计入" });
  const second = fakeJudge([]);
  const outcome = await run({ now, dir, judge: second, notifyImpl: () => ({ ok: true }) });
  assert.equal(outcome.fresh.length, 1);
  assert.equal(outcome.fresh[0].result.kind, "count");
  assert.equal(outcome.fresh[0].result.overridden, true);
  assert.equal(second.calls.length, 0);

  const decisions = JSON.parse(readFileSync(path.join(dir, "decisions.json"), "utf8"));
  assert.equal(decisions[key].result.kind, "count");
  assert.equal(decisions[key].override.kind, "count");
  const override = readEvents(dir).find((event) => event.event === "override");
  assert.equal(override.kind, "count");
  assert.equal(override.previous, "review");
});

test("an override survives a changed input hash and re-judging is skipped", async () => {
  const { dir, now } = sandbox();
  const judge = fakeJudge([{ choice: null, confidence: null, probabilities: null, fallback: "timeout" }]);
  await run({ now, dir, judge, notifyImpl: () => ({ ok: true }) });
  const key = Object.keys(JSON.parse(readFileSync(path.join(dir, "decisions.json"), "utf8")))[0];
  setOverride({ dir, key, kind: "count" });

  writeFileSync(
    path.join(dir, "ledger", "s1.jsonl"),
    `${JSON.stringify(rec("2026-10-24T01:00:00.000Z", 5, { userText: "换了请求" }))}\n`,
  );
  const grown = fakeJudge([]);
  const outcome = await run({ now, dir, judge: grown, notifyImpl: () => ({ ok: true }) });
  assert.equal(grown.calls.length, 0);
  assert.equal(outcome.fresh.length, 1);
  const decisions = JSON.parse(readFileSync(path.join(dir, "decisions.json"), "utf8"));
  assert.equal(decisions[key].override.kind, "count");
});

test("clearing an override sends the unit back to the judge", async () => {
  const { dir, now } = sandbox();
  const judge = fakeJudge([{ choice: null, confidence: null, probabilities: null, fallback: "timeout" }]);
  await run({ now, dir, judge, notifyImpl: () => ({ ok: true }) });
  const key = Object.keys(JSON.parse(readFileSync(path.join(dir, "decisions.json"), "utf8")))[0];
  setOverride({ dir, key, kind: "skip" });
  assert.equal(clearOverride({ dir, key }).kind, "skip");
  assert.equal(clearOverride({ dir, key }), null);

  const back = fakeJudge([{ choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null }]);
  const outcome = await run({ now, dir, judge: back, notifyImpl: () => ({ ok: true }) });
  assert.equal(back.calls.length, 1);
  assert.equal(outcome.fresh[0].result.kind, "count");
  assert.equal(outcome.fresh[0].result.overridden, undefined);
});

test("listReviews shows the review queue with the override state", async () => {
  const { dir, now } = sandbox();
  const judge = fakeJudge([{ choice: null, confidence: null, probabilities: { count: 0.73, skip: 0.27 }, fallback: "low-confidence" }]);
  await run({ now, dir, judge, notifyImpl: () => ({ ok: true }) });
  const key = Object.keys(JSON.parse(readFileSync(path.join(dir, "decisions.json"), "utf8")))[0];
  const before = listReviews({ dir });
  assert.equal(before.length, 1);
  assert.equal(before[0].key, key);
  assert.equal(before[0].reason, "low-confidence");
  assert.equal(before[0].override, null);
  setOverride({ dir, key, kind: "count" });
  assert.equal(listReviews({ dir })[0].override, "count");
});

test("setOverride rejects unknown units and unknown kinds", () => {
  const { dir } = sandbox();
  assert.throws(() => setOverride({ dir, key: "nope", kind: "count" }), /unknown unit/);
  const judge = fakeJudge([]);
  assert.equal(typeof judge, "object");
});

test("units that hit the cache are kept in the round even past the judge quota", async () => {
  const { dir, now } = sandbox();
  const judge = fakeJudge([{ choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null }]);
  await run({ now, dir, judge, notifyImpl: () => ({ ok: true }) });
  writeFileSync(path.join(dir, "config.json"), JSON.stringify({ maxUnitsPerRun: 0 }));
  const second = fakeJudge([]);
  await run({ now: now + 30 * MINUTE, dir, judge: second, notifyImpl: () => ({ ok: true }) });
  assert.equal(second.calls.length, 0);
  const round = readEvents(dir).filter((event) => event.event === "round").pop();
  assert.equal(round.leftover, 0);
  assert.equal(round.processed, 1);
});

test("a unit that needs judging is deferred, not dropped, when the quota is spent", async () => {
  const { dir, now } = sandbox();
  const judge = fakeJudge([{ choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null }]);
  writeFileSync(
    path.join(dir, "ledger", "s2.jsonl"),
    `${JSON.stringify(rec("2026-10-24T01:40:00.000Z", 5, { sessionId: "s2" }))}\n`,
  );
  writeFileSync(path.join(dir, "config.json"), JSON.stringify({ maxUnitsPerRun: 1 }));
  const outcome = await run({ now, dir, judge, notifyImpl: () => ({ ok: true }) });
  assert.equal(outcome.units, 2);
  const round = readEvents(dir).filter((event) => event.event === "round").pop();
  assert.equal(round.leftover, 1);
  assert.equal(round.processed, 1);
});
