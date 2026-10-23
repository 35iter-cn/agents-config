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
  assert.equal(record.magic, "unknown");
  assert.equal(record.fallback, "failed");
  assert.equal(judged, 0);
});

test("TC-U3 missing startedAt falls back to zero duration", async () => {
  const { usage } = harness();
  const record = await usage.recordRun({ job, platform: "feishu", key: "k", session: "s", answer: "", status: "cancelled" });
  assert.equal(record.durationMs, 0);
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
