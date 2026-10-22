import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { createCore, emptyState, renderPrompt, writeJsonAtomic, pruneOldFiles, readJsonOr } from "./core.mjs";

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
  assert.deepEqual(Object.keys(readJsonOr(stateFile, {})), ["cursor", "seen", "convs", "alerts", "meta"]);
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
