import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createUsage } from "./usage.mjs";

function harness({ judge, write } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "relay-usage-"));
  const logs = [];
  const usage = createUsage({
    dir,
    judge: judge ?? { judgeChoice: async () => ({ choice: "magic_work", confidence: 0.93, fallback: null }) },
    log: (level, tag, text) => logs.push([level, tag, text].join(" ")),
    now: () => Date.parse("2026-10-23T04:00:00.000Z"),
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

test("TC-U6 root text precedes the turn text in the judged state", async () => {
  const { seen } = await runWith({ text: "再查一下", rootText: "你 5 分钟向我汇报一下进度" });
  const state = seen[0].state;
  assert.ok(state.indexOf("你 5 分钟") < state.indexOf("再查一下"));
  assert.ok(state.includes("=== agent 产出"));
});

test("TC-U7 root equal to turn text is not duplicated", async () => {
  const { seen } = await runWith({ text: "看下这个", rootText: "看下这个" });
  const state = seen[0].state;
  assert.equal(state.split("看下这个").length - 1, 1);
});

test("TC-U8 answer is truncated to 500 chars while answerHead stays 200", async () => {
  const { record, seen } = await runWith({ text: "t" }, { answer: "x".repeat(1200) });
  assert.ok(seen[0].state.endsWith("x".repeat(500)));
  assert.equal(record.answerHead.length, 200);
});

test("TC-U9 criteria spells out tooling and greeting boundaries", async () => {
  const { seen } = await runWith({ text: "t" });
  assert.match(seen[0].criteria.magic_work, /公司工具链/);
  assert.match(seen[0].criteria.non_magic, /纯问候/);
});

test("TC-U10 magic asset keyword decides without calling the judge", async () => {
  const { record, seen } = await runWith({ text: "把 MD STACK 里的 owner-portal 重启一下" });
  assert.equal(record.magic, "magic_work");
  assert.equal(record.confidence, 1);
  assert.equal(record.judgeSource, "rule");
  assert.equal(seen.length, 0);
});

test("TC-U11 greeting only decides non_magic without calling the judge", async () => {
  const { record, seen } = await runWith({ text: "早上好！" });
  assert.equal(record.magic, "non_magic");
  assert.equal(record.judgeSource, "rule");
  assert.equal(seen.length, 0);
});

test("TC-U12 root context drives the rule layer", async () => {
  const { record, seen } = await runWith({ text: "再查一下", rootText: "Company Portal 的 HEIC 上传问题继续跟" });
  assert.equal(record.magic, "magic_work");
  assert.equal(record.judgeSource, "rule");
  assert.equal(seen.length, 0);
});
