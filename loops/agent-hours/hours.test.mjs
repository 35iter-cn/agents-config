import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildUnits,
  chunkMessage,
  decideUnit,
  formatReport,
  readLedger,
  run,
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
  assert.match(sent[0], /工时判定/);

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
  assert.equal(round.fresh, 1);
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
  assert.ok(outcome.report.includes("工时判定"));
  assert.equal(existsSync(path.join(dir, "decisions.json")), false);
  assert.equal(existsSync(path.join(dir, "digest")), false);
  assert.equal(existsSync(path.join(dir, "logs")), false);
});

test("ledger reader ignores records older than the window", () => {
  const { dir, now } = sandbox();
  const fresh = readLedger(path.join(dir, "ledger"), { now });
  assert.equal(fresh.length, 2);
  const stale = readLedger(path.join(dir, "ledger"), { now: now + 3 * 24 * 60 * MINUTE });
  assert.equal(stale.length, 0);
});

test("report header counts each verdict and totals counted minutes", () => {
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
  assert.match(report, /计入 1 \/ 不计 0 \/ 待确认 1/);
  assert.match(report, /合计 10 分钟/);
  assert.match(report, /待确认 .*low-margin/);
});
