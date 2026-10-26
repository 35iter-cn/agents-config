import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createUsage } from "./usage.mjs";

function harness({ judge, write, now } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "relay-usage-"));
  const logs = [];
  const usage = createUsage({
    dir,
    judge: judge ?? { judgeChoice: async () => ({ choice: "magic_work", confidence: 0.93, fallback: null }) },
    log: (level, tag, text) => logs.push([level, tag, text].join(" ")),
    now: now ?? (() => Date.parse("2026-10-23T04:00:00.000Z")),
    write,
  });
  return { usage, dir, logs };
}

const job = { id: "job-1", inbound: { text: "改一下 core.mjs" }, createdAt: "2026-10-23T03:59:00.000Z" };

function read(dir) {
  return readFileSync(join(dir, "2026-10-23.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

test("TC-U1 done writes one complete record with answerHead", async () => {
  const { usage, dir } = harness();
  const record = await usage.recordRun({
    job,
    platform: "feishu",
    key: "th-x",
    session: "fs-th-x",
    answer: "x".repeat(300),
    status: "done",
    startedAt: Date.parse("2026-10-23T03:59:30.000Z"),
  });
  assert.equal(record.status, "done");
  assert.equal(record.magic, "magic_work");
  assert.equal(record.confidence, 0.93);
  assert.equal(record.answerHead.length, 200);
  assert.equal(record.answerChars, 300);
  assert.equal(record.durationMs, 30_000);
  assert.equal(record.inputChars, job.inbound.text.length);
  const lines = read(dir);
  assert.equal(lines.length, 1);
  assert.deepEqual(Object.keys(lines[0]).sort(), Object.keys(record).sort());
});

test("TC-U2 failed status skips answerHead and magic judging", async () => {
  let judged = 0;
  const { usage } = harness({
    judge: { judgeChoice: async () => { judged += 1; return { choice: "magic_work", confidence: 0.9, fallback: null }; } },
  });
  const record = await usage.recordRun({ job, platform: "feishu", key: "k", session: "s", answer: "boom", status: "failed", startedAt: 0 });
  assert.equal(record.answerHead, undefined);
  assert.equal(record.magic, "unjudged");
  assert.equal(record.fallback, "failed");
  assert.equal(judged, 0);
});

test("TC-U3 missing startedAt falls back to zero duration", async () => {
  const { usage } = harness();
  const record = await usage.recordRun({ job, platform: "feishu", key: "k", session: "s", answer: "", status: "cancelled" });
  assert.equal(record.durationMs, 0);
  assert.equal(record.magic, "unjudged");
  assert.equal(record.fallback, "cancelled");
});

test("TC-U4 write failure is logged and does not throw", async () => {
  const { usage, logs } = harness({ write: () => { throw new Error("disk full"); } });
  const record = await usage.recordRun({ job, platform: "feishu", key: "k", session: "s", answer: "ok", status: "done", startedAt: 0 });
  assert.equal(record, null);
  assert.ok(logs.some((line) => line.includes("usage")));
});

test("TC-U5 judge failure keeps magic unknown with fallback", async () => {
  const { usage } = harness({ judge: { judgeChoice: async () => ({ choice: null, confidence: null, fallback: "nokey" }) } });
  const record = await usage.recordRun({ job, platform: "feishu", key: "k", session: "s", answer: "ok", status: "done", startedAt: 0 });
  assert.equal(record.magic, "unknown");
  assert.equal(record.fallback, "nokey");
});

function captureState() {
  const seen = [];
  const judge = {
    judgeChoice: async (args) => {
      seen.push(args);
      return { choice: "magic_work", confidence: 0.9, fallback: null };
    },
  };
  return { seen, judge };
}

function runWith(state, args = {}) {
  const { seen, judge } = captureState();
  const { usage } = harness({ judge });
  return usage
    .recordRun({ job: { id: "job-x", inbound: state }, platform: "feishu", key: "k", session: "s", answer: "ok", status: "done", startedAt: 0, ...args })
    .then((record) => ({ record, seen }));
}

test("TC-U6 state keeps start message before the turn message", async () => {
  const { seen } = await runWith({ text: "再查一下", rootText: "你 5 分钟向我汇报一下进度" });
  const state = seen[0].state;
  assert.ok(state.indexOf("【话题起始消息】") < state.indexOf("【本轮用户消息】"));
  assert.ok(state.indexOf("你 5 分钟") < state.indexOf("再查一下"));
  assert.ok(state.includes("【agent 本轮回答（仅供参考，不是用户请求）】"));
});

test("TC-U7 start message equal to the turn is not duplicated", async () => {
  const { seen } = await runWith({ text: "早上好", rootText: "早上好" });
  const state = seen[0].state;
  assert.equal(state.split("早上好").length - 1, 1);
  assert.ok(state.includes("(无，本级即话题起点)"));
});

test("TC-U8 answer is truncated to 400 chars while answerHead stays 200", async () => {
  const { record, seen } = await runWith({ text: "t" }, { answer: "x".repeat(1200) });
  assert.ok(seen[0].state.endsWith("x".repeat(400)));
  assert.equal(record.answerHead.length, 200);
});

test("TC-U9 criteria carries the asset list and the exclusion list", async () => {
  const { seen } = await runWith({ text: "t" });
  const magicWork = seen[0].criteria.magic_work;
  assert.match(magicWork, /agents-config/);
  assert.match(magicWork, /MD STACK/);
  assert.match(magicWork, /明确不属于/);
  assert.match(magicWork, /纯问候/);
});

test("TC-U10 instructions point the model at the inputs it actually has", async () => {
  const { seen } = await runWith({ text: "t" });
  assert.match(seen[0].instructions, /指代/);
  assert.match(seen[0].instructions, /话题起始消息/);
  assert.match(seen[0].instructions, /不算 magic_work/);
  assert.doesNotMatch(seen[0].instructions, /前几轮/);
});

test("TC-U11 done runs record the judge verdict", async () => {
  const { seen, record } = await runWith({ text: "早上好" });
  assert.equal(seen.length, 1);
  assert.equal(record.magic, "magic_work");
});

test("TC-U12 log file is named by the Asia/Shanghai day, not the UTC day", async () => {
  const { usage, dir } = harness({ now: () => Date.parse("2026-10-25T17:30:00.000Z") });
  await usage.recordRun({ job, platform: "feishu", key: "k", session: "s", answer: "ok", status: "done", startedAt: Date.parse("2026-10-25T17:29:00.000Z") });
  const lines = readFileSync(join(dir, "2026-10-26.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).ts, "2026-10-25T17:30:00.000Z");
});
