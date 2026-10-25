import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireLock,
  buildUnits,
  chunkMessage,
  clearOverride,
  decideUnit,
  formatDuration,
  formatReport,
  humanCoverage,
  listReviews,
  planOperations,
  readDecisions,
  readLedger,
  run,
  runHash,
  runState,
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

test("a single run unit is never split, even when the verdict is low margin", async () => {
  const [unit] = buildUnits([rec("2026-10-24T01:00:00.000Z", 5)]);
  const lowMargin = fakeJudge([
    { choice: "count", confidence: 0.55, probabilities: { count: 0.54, skip: 0.46 }, fallback: null },
  ]);
  const result = await decideUnit(unit, { judge: lowMargin });
  assert.equal(result.kind, "review");
  assert.equal(result.reason, "low-margin");
  assert.equal(result.runs, null);
  assert.equal(lowMargin.calls.length, 1);

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
  const ledgerFile = path.join(dir, "ledger", "s1.jsonl");
  writeFileSync(
    ledgerFile,
    `${JSON.stringify(rec("2026-10-24T01:00:00.000Z", 5))}\n${JSON.stringify(rec("2026-10-24T01:10:00.000Z", 5))}\n`,
  );
  const stamp = now / 1000;
  utimesSync(ledgerFile, stamp, stamp);
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
  assert.equal(decisions.version, 2);
  const entry = Object.values(decisions.units)[0];
  assert.equal(entry.result.kind, "count");
  assert.equal(typeof entry.notifiedSig, "string");
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
  assert.equal(Object.values(decisions.units)[0].notifiedSig, null);
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
  assert.equal(typeof round.calls, "number");
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

test("dry run writes nothing and leaves a v1 cache untouched", async () => {
  const { dir, now } = sandbox();
  const unit = SANDBOX_UNIT();
  const v1 = { [unit.key]: { hash: "stale", result: { kind: "review", reason: "low-confidence" }, notifiedHash: null, judgedAt: "2026-10-24T01:20:00.000Z" } };
  writeFileSync(path.join(dir, "decisions.json"), JSON.stringify(v1));
  const judge = fakeJudge([
    { choice: null, confidence: 0.12, probabilities: { count: 0.44, skip: 0.56 }, fallback: "low-confidence" },
    { choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null },
    { choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null },
  ]);
  const outcome = await run({ now, dir, judge, dryRun: true, notifyImpl: () => ({ ok: true }) });
  assert.equal(outcome.fresh.length, 1);
  assert.ok(outcome.report.includes("**工时**"));
  assert.equal(readFileSync(path.join(dir, "decisions.json"), "utf8"), JSON.stringify(v1));
  assert.equal(existsSync(path.join(dir, "decisions.v1.bak.json")), false);
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
  assert.match(lines[2], /计入时长 10 分钟/);
});

test("durations switch to hours once they pass an hour", () => {
  assert.equal(formatDuration(0), "0 分钟");
  assert.equal(formatDuration(59), "59 分钟");
  assert.equal(formatDuration(60), "1 小时");
  assert.equal(formatDuration(66), "1.1 小时");
  assert.equal(formatDuration(90), "1.5 小时");
  assert.equal(formatDuration(167), "2.8 小时");
});

test("a report longer than an hour shows hours instead of raw minutes", () => {
  const units = buildUnits([
    rec("2026-10-24T01:00:00.000Z", 50, { sessionId: "a" }),
    rec("2026-10-24T02:00:00.000Z", 20, { sessionId: "b" }),
  ]);
  const report = formatReport(
    units.map((unit) => ({ unit, result: { kind: "count", p: { count: 0.9 }, margin: 0.8 } })),
    {
      tz: DEFAULTS.tz,
      now: Date.parse("2026-10-24T13:00:00.000Z"),
      clock: { created: 1, patched: 0, deleted: 0, conflict: 1, conflictMinutes: 75, failed: 0, blocked: [] },
    },
  );
  assert.match(report, /计入时长 1\.2 小时/);
  assert.match(report, /冲突 1\.3 小时/);
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
  const key = Object.keys(JSON.parse(readFileSync(path.join(dir, "decisions.json"), "utf8")).units)[0];

  setOverride({ dir, key, kind: "count", note: "MagicDoor 事务（PR 审批状态确认），人工裁定计入", now });
  const second = fakeJudge([]);
  const outcome = await run({ now, dir, judge: second, notifyImpl: () => ({ ok: true }) });
  assert.equal(outcome.fresh.length, 1);
  assert.equal(outcome.fresh[0].result.kind, "count");
  assert.equal(outcome.fresh[0].result.overridden, true);
  assert.equal(second.calls.length, 0);

  const decisions = JSON.parse(readFileSync(path.join(dir, "decisions.json"), "utf8"));
  assert.equal(decisions.units[key].result.kind, "count");
  assert.equal(decisions.units[key].override.kind, "count");
  const override = readEvents(dir).find((event) => event.event === "override");
  assert.equal(override.kind, "count");
  assert.equal(override.previous, "review");
});

test("an override survives a changed input hash and re-judging is skipped", async () => {
  const { dir, now } = sandbox();
  const judge = fakeJudge([{ choice: null, confidence: null, probabilities: null, fallback: "timeout" }]);
  await run({ now, dir, judge, notifyImpl: () => ({ ok: true }) });
  const key = Object.keys(JSON.parse(readFileSync(path.join(dir, "decisions.json"), "utf8")).units)[0];
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
  assert.equal(decisions.units[key].override.kind, "count");
});

test("clearing an override sends the unit back to the judge", async () => {
  const { dir, now } = sandbox();
  const judge = fakeJudge([{ choice: null, confidence: null, probabilities: null, fallback: "timeout" }]);
  await run({ now, dir, judge, notifyImpl: () => ({ ok: true }) });
  const key = Object.keys(JSON.parse(readFileSync(path.join(dir, "decisions.json"), "utf8")).units)[0];
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
  const key = Object.keys(JSON.parse(readFileSync(path.join(dir, "decisions.json"), "utf8")).units)[0];
  const before = listReviews({ dir });
  assert.equal(before.length, 1);
  assert.equal(before[0].key, key);
  assert.equal(before[0].reason, "pending");
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
  writeFileSync(path.join(dir, "config.json"), JSON.stringify({ maxJudgeCallsPerRun: 0 }));
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
  writeFileSync(path.join(dir, "config.json"), JSON.stringify({ maxJudgeCallsPerRun: 1 }));
  const outcome = await run({ now, dir, judge, notifyImpl: () => ({ ok: true }) });
  assert.equal(outcome.units, 2);
  const round = readEvents(dir).filter((event) => event.event === "round").pop();
  assert.equal(round.leftover, 1);
  assert.equal(round.processed, 1);
});

test("a run hash carries the prompt version and the run text", () => {
  const [unit] = buildUnits([rec("2026-10-24T01:00:00.000Z", 5)]);
  const run0 = unit.runs[0];
  const first = runHash(run0);
  assert.equal(first.length, 16);
  assert.notEqual(first, runHash({ ...run0, userText: "换了请求" }));
  assert.equal(first, runHash({ ...run0 }));
  assert.match(runState(run0), /【用户请求】/);
});

const SPLIT_ROWS = () => [
  rec("2026-10-24T01:00:00.000Z", 5, { userText: "客户 PR 评审", output: "批注三条" }),
  rec("2026-10-24T01:10:00.000Z", 5, { userText: "relay 标记实现", output: "改了 core.mjs" }),
];

function splitSandbox() {
  const sandboxDir = sandbox();
  writeFileSync(
    path.join(sandboxDir.dir, "ledger", "s1.jsonl"),
    `${SPLIT_ROWS().map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  return sandboxDir;
}

const SANDBOX_UNIT = () => buildUnits(SPLIT_ROWS())[0];

function singleSandbox() {
  const box = sandbox();
  writeFileSync(path.join(box.dir, "ledger", "s1.jsonl"), `${JSON.stringify(rec("2026-10-24T01:00:00.000Z", 5))}\n`);
  return box;
}

test("a v1 decisions file is migrated in place and its low confidence units split", async () => {
  const { dir, now } = splitSandbox();
  const unit = SANDBOX_UNIT();
  writeFileSync(
    path.join(dir, "decisions.json"),
    JSON.stringify({ [unit.key]: { hash: unitHash(unit), result: { kind: "review", reason: "low-confidence", p: { count: 0.5, skip: 0.5 } }, notifiedHash: null, judgedAt: "2026-10-24T01:20:00.000Z" } }),
  );
  const judge = fakeJudge([
    { choice: null, confidence: 0.2, probabilities: { count: 0.5, skip: 0.5 }, fallback: "low-confidence" },
    { choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null },
    { choice: "skip", confidence: 0.9, probabilities: { count: 0.1, skip: 0.9 }, fallback: null },
  ]);
  const outcome = await run({ now, dir, judge, notifyImpl: () => ({ ok: true }) });
  const cache = readDecisions(path.join(dir, "decisions.json"));
  assert.equal(cache.version, 2);
  assert.equal(Object.keys(cache.splits).length, 2);
  assert.equal(cache.units[unit.key].result.kind, "count");
  assert.equal(cache.units[unit.key].result.split, true);
  assert.equal(outcome.fresh[0].result.kind, "count");
  assert.ok(existsSync(path.join(dir, "decisions.v1.bak.json")));
  assert.equal(judge.calls.length, 3);
});

test("low confidence splits into runs, caches them and writes only the counted ones", async () => {
  const { dir, now } = splitSandbox();
  const judge = fakeJudge([
    { choice: null, confidence: 0.12, probabilities: { count: 0.44, skip: 0.56 }, fallback: "low-confidence" },
    { choice: "count", confidence: 0.78, probabilities: { count: 0.78, skip: 0.22 }, fallback: null },
    { choice: "skip", confidence: 0.86, probabilities: { count: 0.07, skip: 0.93 }, fallback: null },
  ]);
  const outcome = await run({ now, dir, judge, notifyImpl: () => ({ ok: true }) });
  assert.equal(outcome.fresh.length, 1);
  assert.equal(outcome.fresh[0].result.kind, "count");
  assert.equal(outcome.fresh[0].result.split, true);
  assert.equal(outcome.fresh[0].result.runs.length, 2);
  assert.deepEqual(outcome.fresh[0].result.runs.map((item) => item.kind), ["count", "skip"]);

  const again = fakeJudge([]);
  const round = await run({ now: now + 30 * MINUTE, dir, judge: again, notifyImpl: () => ({ ok: true }) });
  assert.equal(again.calls.length, 0);
  assert.equal(round.fresh.length, 0);
});

test("a pending verdict turns into a verdict once and is not re-announced while pending", async () => {
  const { dir, now } = sandbox();
  const timeoutJudge = fakeJudge([{ choice: null, confidence: null, probabilities: null, fallback: "timeout" }]);
  const first = await run({ now, dir, judge: timeoutJudge, notifyImpl: () => ({ ok: true }) });
  assert.equal(first.fresh[0].result.kind, "review");
  assert.equal(first.fresh[0].result.reason, "timeout");

  const stillDown = fakeJudge([{ choice: null, confidence: null, probabilities: null, fallback: "timeout" }]);
  const second = await run({ now: now + 30 * MINUTE, dir, judge: stillDown, notifyImpl: () => ({ ok: true }) });
  assert.equal(stillDown.calls.length, 1);
  assert.equal(second.fresh.length, 0);

  const back = fakeJudge([{ choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null }]);
  const third = await run({ now: now + 60 * MINUTE, dir, judge: back, notifyImpl: () => ({ ok: true }) });
  assert.equal(third.fresh.length, 1);
  assert.equal(third.fresh[0].result.kind, "count");
});

test("a pending run inside a split unit keeps the settled runs and retries only the open one", async () => {
  const { dir, now } = splitSandbox();
  const judge = fakeJudge([
    { choice: null, confidence: 0.12, probabilities: { count: 0.44, skip: 0.56 }, fallback: "low-confidence" },
    { choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null },
    { choice: null, confidence: null, probabilities: null, fallback: "circuit" },
  ]);
  const outcome = await run({ now, dir, judge, notifyImpl: () => ({ ok: true }) });
  const result = outcome.fresh[0].result;
  assert.equal(result.kind, "count");
  assert.equal(result.reason, "partial");
  assert.deepEqual(result.runs.map((item) => item.kind), ["count", "review"]);

  const cache = readDecisions(path.join(dir, "decisions.json"));
  assert.equal(Object.keys(cache.splits).length, 1);
  const retry = fakeJudge([{ choice: "skip", confidence: 0.9, probabilities: { count: 0.1, skip: 0.9 }, fallback: null }]);
  await run({ now: now + 30 * MINUTE, dir, judge: retry, notifyImpl: () => ({ ok: true }) });
  assert.equal(retry.calls.length, 1);
});

test("the judge quota counts every split call", async () => {
  const { dir, now } = splitSandbox();
  writeFileSync(path.join(dir, "config.json"), JSON.stringify({ maxJudgeCallsPerRun: 2 }));
  const judge = fakeJudge([
    { choice: null, confidence: 0.12, probabilities: { count: 0.44, skip: 0.56 }, fallback: "low-confidence" },
    { choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null },
    { choice: "count", confidence: 0.9, probabilities: { count: 0.9, skip: 0.1 }, fallback: null },
  ]);
  await run({ now, dir, judge, notifyImpl: () => ({ ok: true }) });
  const round = readEvents(dir).filter((event) => event.event === "round").pop();
  assert.equal(round.calls, 2);
});

test("a single run unit with low confidence keeps its reason, caches it and is not re-judged", async () => {
  const { dir, now } = singleSandbox();
  const single = fakeJudge([{ choice: null, confidence: 0.12, probabilities: { count: 0.44, skip: 0.56 }, fallback: "low-confidence" }]);
  const first = await run({ now, dir, judge: single, notifyImpl: () => ({ ok: true }) });
  assert.equal(first.fresh[0].result.kind, "review");
  assert.equal(first.fresh[0].result.reason, "low-confidence");
  assert.equal(single.calls.length, 1);
  const cache = readDecisions(path.join(dir, "decisions.json"));
  assert.equal(Object.keys(cache.splits).length, 0);

  const again = fakeJudge([]);
  await run({ now: now + 30 * MINUTE, dir, judge: again, notifyImpl: () => ({ ok: true }) });
  assert.equal(again.calls.length, 0);
});

test("plan operations free space before creating finer segments", () => {
  const plan = {
    remove: ["stale"],
    patch: [{ id: "coarse", start: 0, end: 5 * MINUTE }],
    create: [
      { start: 6 * MINUTE, end: 10 * MINUTE },
      { start: 11 * MINUTE, end: 15 * MINUTE },
    ],
  };
  const ops = planOperations(plan, { budget: 10 });
  assert.deepEqual(ops.map((op) => op.op), ["remove", "patch", "create", "create"]);
  assert.deepEqual(planOperations(plan, { budget: 2 }).map((op) => op.op), ["remove", "patch"]);
});

test("human coverage keeps only foreign periods of the same activity", () => {
  const periods = [
    { id: "own", activityId: "activity_work_001", start: 0, end: 10 * MINUTE },
    { id: "user", activityId: "activity_work_001", start: 20 * MINUTE, end: 30 * MINUTE },
    { id: "break", activityId: "activity_break_001", start: 40 * MINUTE, end: 50 * MINUTE },
  ];
  const covered = humanCoverage(periods, { ownIds: new Set(["own"]), activityId: "activity_work_001" });
  assert.deepEqual(covered, [{ start: 20 * MINUTE, end: 30 * MINUTE }]);
});
