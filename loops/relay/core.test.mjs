import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { createCore, emptyState, renderPrompt, writeJsonAtomic, pruneOldFiles, readJsonOr } from "./core.mjs";

function controlledChild() {
  const child = new EventEmitter();
  child.pid = 999999;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  child.finish = (code = 0) => child.emit("close", code);
  return child;
}

function fakeChild({ stdout = "", stderr = "", code = 0, onClose } = {}) {
  const child = new EventEmitter();
  child.pid = 999999;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setImmediate(() => {
    if (stdout) child.stdout.emit("data", stdout);
    if (stderr) child.stderr.emit("data", stderr);
    onClose?.(child);
    child.emit("close", code);
  });
  return child;
}

function harness({ spawn, replies = [], adapterOverrides = {}, state = emptyState(), sessions = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "relay-core-"));
  const sessionsDir = join(dir, "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  for (const name of sessions) writeFileSync(join(sessionsDir, `2026-01-01T00-00-00_${name}.jsonl`), "{}\n");
  const promptFile = join(dir, "thread.md");
  writeFileSync(promptFile, "conversation={{conversation}} user={{user_message}} root={{root_text}} platform={{platform}} rules={{reply_rules}}");
  const stateFile = join(dir, "relay-fake.json");
  writeJsonAtomic(stateFile, state);
  const adapter = {
    name: "fake",
    allowedUser: "u-ok",
    chunkLimit: 20,
    timeoutMs: 1000,
    maxWorkers: 2,
    queueDepth: 1,
    worker: "stub",
    piBin: "/bin/true",
    replyRules: "RULES",
    reply: async (inbound, text) => replies.push({ key: inbound.key, text }),
    ...adapterOverrides,
  };
  const logs = [];
  const core = createCore({
    adapter,
    paths: { stateFile, logDir: join(dir, "logs"), sessionsDir, promptFile, cwd: dir, home: dir },
    deps: { spawn: spawn ?? (() => fakeChild({ stdout: "ok" })), log: (level, ...parts) => logs.push([level, ...parts].join(" ")) },
  });
  return { core, adapter, replies, logs, dir, stateFile, sessionsDir };
}

function inbound(overrides = {}) {
  return { key: "th-abc", session: "fs-th-abc", dedupeId: "m1", authorId: "u-ok", text: "hello", chatId: "c1", ...overrides };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

test("TC-1 first turn injects the rendered prompt template", async () => {
  const captured = [];
  const { core } = harness({
    adapterOverrides: { buildWorker: ({ prompt, full }) => (captured.push({ prompt, full }), { bin: "/bin/true", args: [] }) },
  });
  await core.handle(inbound({ text: "第一条" }));
  await tick();
  assert.equal(captured.length, 1);
  assert.equal(captured[0].full, true);
  assert.match(captured[0].prompt, /conversation=th-abc/);
  assert.match(captured[0].prompt, /rules=RULES/);
  assert.doesNotMatch(captured[0].prompt, /\{\{/);
});

test("TC-2 a message with an existing session sends only the raw text", async () => {
  const captured = [];
  const { core } = harness({
    sessions: ["fs-th-abc"],
    adapterOverrides: { buildWorker: ({ prompt, full }) => (captured.push({ prompt, full }), { bin: "/bin/true", args: [] }) },
  });
  await core.handle(inbound({ text: "续上" }));
  await tick();
  assert.equal(captured[0].full, false);
  assert.equal(captured[0].prompt, "续上");
});

test("TC-3 duplicate delivery is dropped without touching state or spawning", async () => {
  let spawned = 0;
  const { core, replies } = harness({ spawn: () => (spawned++, fakeChild({ stdout: "ok" })) });
  assert.equal(await core.handle(inbound()), "accepted");
  await tick();
  assert.equal(await core.handle(inbound()), "duplicate");
  await tick();
  assert.equal(spawned, 1);
  assert.equal(replies.length, 1);
  assert.deepEqual(Object.keys(core.state.convs), ["th-abc"]);
});

test("author outside the allow list is ignored", async () => {
  const { core, replies } = harness();
  assert.equal(await core.handle(inbound({ authorId: "u-stranger", dedupeId: "m2" })), "ignored");
  await tick();
  assert.equal(replies.length, 0);
  assert.deepEqual(core.state.convs, {});
});

test("TC-4 queue rejects beyond maxWorkers plus queueDepth", async () => {
  const blockers = [];
  const { core, replies } = harness({
    spawn: () => {
      const child = fakeChild({ stdout: "done" });
      blockers.push(child);
      return child;
    },
  });
  const never = () => new Promise(() => {});
  void never;
  const accepted = await Promise.all([
    core.handle(inbound({ dedupeId: "a", key: "k1", session: "fs-k1" })),
    core.handle(inbound({ dedupeId: "b", key: "k2", session: "fs-k2" })),
    core.handle(inbound({ dedupeId: "c", key: "k3", session: "fs-k3" })),
    core.handle(inbound({ dedupeId: "d", key: "k4", session: "fs-k4" })),
  ]);
  assert.deepEqual(accepted, ["accepted", "accepted", "accepted", "busy"]);
  assert.equal(replies.at(-1).text.includes("当前繁忙"), true);
  assert.deepEqual(core.stats(), { running: 2, pending: 1 });
  blockers.forEach((child) => child.emit("close", 0));
});

test("TC-6 state writes are atomic and leave no temp files behind", async () => {
  const { core, dir, stateFile } = harness();
  await core.handle(inbound());
  await tick();
  const leftovers = readdirSync(dir).filter((name) => name.includes(".tmp-"));
  assert.deepEqual(leftovers, []);
  assert.deepEqual(Object.keys(readJsonOr(stateFile, {})), ["cursor", "seen", "convs", "alerts", "meta", "jobs", "inbox"]);
});

test("TC-7 log files older than 72h are pruned, fresh ones kept", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-prune-"));
  writeFileSync(join(dir, "old.jsonl"), "x");
  writeFileSync(join(dir, "fresh.jsonl"), "x");
  const old = (Date.now() - 73 * 3_600_000) / 1000;
  utimesSync(join(dir, "old.jsonl"), old, old);
  const removed = pruneOldFiles(dir, 72 * 3_600_000);
  assert.deepEqual(removed, ["old.jsonl"]);
  assert.deepEqual(readdirSync(dir), ["fresh.jsonl"]);
});

test("TC-5 a worker over its timeout is killed as a process group", async () => {
  const { spawn } = await import("node:child_process");
  const replies = [];
  const started = Date.now();
  const { core } = harness({
    spawn,
    replies,
    adapterOverrides: {
      timeoutMs: 300,
      buildWorker: () => ({ bin: process.execPath, args: ["-e", "setTimeout(() => {}, 60000)"] }),
    },
  });
  await core.handle(inbound());
  while (!replies.length && Date.now() - started < 5000) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(Date.now() - started < 5000, "timeout path took too long");
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /已终止/);
});

test("reply failures are logged and do not throw", async () => {
  const { core, logs } = harness({
    adapterOverrides: { reply: async () => { throw new Error("boom"); } },
  });
  await core.handle(inbound());
  await tick();
  assert.ok(logs.some((line) => line.includes("reply") && line.includes("boom")));
});

test("renderPrompt replaces every placeholder", () => {
  assert.equal(renderPrompt("{{a}}-{{b}}", { a: 1, b: "x" }), "1-x");
  assert.equal(renderPrompt("no placeholders", {}), "no placeholders");
});

test("TC-24 a duplicate for an unfinished job resumes it instead of dropping it", async () => {
  const { core, replies } = harness({ adapterOverrides: { maxWorkers: 0, queueDepth: 5 } });
  assert.equal(await core.handle(inbound()), "accepted");
  const jobId = core.state.seen.m1;
  assert.equal(core.state.jobs[jobId].status, "queued");
  assert.equal(await core.handle(inbound()), "accepted");
  assert.equal(core.state.inbox.filter((id) => id === jobId).length, 1);
  assert.equal(replies.length, 0);
});

test("TC-24 a duplicate for a finished job is dropped", async () => {
  const { core } = harness();
  assert.equal(await core.handle(inbound()), "accepted");
  await tick();
  assert.equal(core.state.jobs[core.state.seen.m1].status, "done");
  assert.equal(await core.handle(inbound()), "duplicate");
});

test("legacy seen values are treated as already answered", async () => {
  const { core } = harness({ state: { cursor: null, seen: { old: "2026-01-01T00:00:00.000Z" }, convs: {}, alerts: {}, meta: {} } });
  assert.equal(core.state.seen.old, "legacy");
  assert.equal(core.state.meta.schemaVersion, 2);
  assert.equal(await core.handle(inbound({ dedupeId: "old" })), "duplicate");
  assert.deepEqual(core.state.jobs, {});
});

test("TC-25 two messages in one conversation never run at the same time", async () => {
  const spawned = [];
  const { core } = harness({
    spawn: () => {
      const child = controlledChild();
      spawned.push(child);
      return child;
    },
  });
  assert.equal(await core.handle(inbound({ dedupeId: "m1" })), "accepted");
  assert.equal(spawned.length, 1);
  assert.equal(await core.handle(inbound({ dedupeId: "m2" })), "accepted");
  assert.equal(spawned.length, 1, "second message waits for the first to finish");
  assert.deepEqual(core.stats(), { running: 1, pending: 1 });

  spawned[0].stdout.emit("data", "first");
  spawned[0].finish(0);
  await tick();
  assert.equal(spawned.length, 2, "second message starts once the first is done");
  assert.equal(core.state.jobs[core.state.seen.m1].status, "done");
  assert.equal(core.state.jobs[core.state.seen.m2].status, "running");

  spawned[1].stdout.emit("data", "second");
  spawned[1].finish(0);
  await tick();
  assert.equal(core.state.jobs[core.state.seen.m2].status, "done");
  assert.equal(core.state.convs["th-abc"].activeJob, null);
});

test("TC-25 different conversations run in parallel up to maxWorkers", async () => {
  const spawned = [];
  const { core } = harness({
    spawn: () => {
      const child = controlledChild();
      spawned.push(child);
      return child;
    },
  });
  await core.handle(inbound({ dedupeId: "a", key: "k1", session: "fs-k1" }));
  await core.handle(inbound({ dedupeId: "b", key: "k2", session: "fs-k2" }));
  assert.equal(spawned.length, 2);
  assert.equal(core.stats().running, 2);
  spawned.forEach((child) => child.finish(0));
  await tick();
  assert.equal(core.stats().running, 0);
});

test("TC-20 a queued job walks queued → running → answered → done", async () => {
  const observed = [];
  let core;
  const built = harness({
    adapterOverrides: {
      reply: async () => {
        const job = Object.values(core.state.jobs)[0];
        observed.push({ status: job.status, answer: job.answer });
      },
    },
  });
  core = built.core;
  assert.equal(await core.handle(inbound()), "accepted");
  const job = Object.values(core.state.jobs)[0];
  assert.equal(job.status, "running");
  assert.equal(typeof job.lease.pid, "number");
  await tick();
  assert.equal(observed.length, 1);
  assert.equal(observed[0].status, "answered", "the answer is committed before it is shown");
  assert.equal(observed[0].answer, "ok");
  assert.equal(job.status, "done");
  assert.equal(job.lease, null);
});

test("TC-27 a done job drops the answer body but keeps its parts", async () => {
  const { core, stateFile } = harness();
  await core.handle(inbound());
  await tick();
  const job = core.state.jobs[core.state.seen.m1];
  assert.equal(job.status, "done");
  assert.equal(job.answer, undefined);
  assert.ok(Array.isArray(job.parts));
  const onDisk = readJsonOr(stateFile, {});
  assert.equal(onDisk.jobs[core.state.seen.m1].answer, undefined);
});

test("TC-27 a failed job keeps its answer for diagnosis", async () => {
  const { core } = harness({ spawn: () => fakeChild({ stdout: "", code: 2 }) });
  await core.handle(inbound());
  await tick();
  const job = core.state.jobs[core.state.seen.m1];
  assert.equal(job.status, "failed");
  assert.match(job.answer, /无输出/);
});

test("TC-23 every delivered chunk is committed to parts with its hash", async () => {
  const delivered = [];
  const { core } = harness({
    spawn: () => fakeChild({ stdout: "a".repeat(45) }),
    adapterOverrides: {
      reply: async (ctx, text) => {
        delivered.push({ text, replyTo: ctx.replyTo });
        return { messageId: `m-${delivered.length}` };
      },
    },
  });
  await core.handle(inbound());
  await tick();
  const job = core.state.jobs[core.state.seen.m1];
  assert.equal(delivered.length, 3, "45 chars at 20 per chunk is three chunks");
  assert.equal(job.parts.length, 3);
  assert.deepEqual(job.parts.map((part) => part.i), [0, 1, 2]);
  assert.deepEqual(job.parts.map((part) => part.messageId), ["m-1", "m-2", "m-3"]);
  assert.equal(job.parts[0].hash.length, 16);
  assert.equal(delivered[1].replyTo, "m-1", "later chunks reply to the previous one");
  assert.equal(delivered[2].replyTo, "m-2");
});

test("TC-23 a reply failure stops delivery and keeps the job answered for a later resend", async () => {
  let calls = 0;
  const { core } = harness({
    spawn: () => fakeChild({ stdout: "a".repeat(45) }),
    adapterOverrides: {
      reply: async () => {
        calls += 1;
        if (calls === 2) throw new Error("platform down");
        return { messageId: "m-1" };
      },
    },
  });
  await core.handle(inbound());
  await tick();
  const job = core.state.jobs[core.state.seen.m1];
  assert.equal(job.status, "answered");
  assert.equal(job.parts.length, 1);
  assert.ok(job.answer);
});

test("TC-23 an adapter without edit never tries to patch", async () => {
  const { core } = harness({
    adapterOverrides: {
      reply: async () => ({ messageId: "m-1" }),
    },
  });
  await core.handle(inbound());
  await tick();
  const job = core.state.jobs[core.state.seen.m1];
  assert.equal(job.status, "done");
  assert.equal(typeof core.state.jobs[core.state.seen.m1].answer, "undefined");
});
