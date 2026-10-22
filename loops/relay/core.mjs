#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn as spawnProcess } from "node:child_process";
import { join } from "node:path";
import { chunkText } from "./chunk.mjs";

const RETENTION_MS = 72 * 3_600_000;

export function defaultLog(level, ...parts) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg: parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ") });
  process.stderr.write(`${line}\n`);
}

export function readJsonOr(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function emptyState() {
  return { cursor: null, seen: {}, convs: {}, alerts: {}, meta: {} };
}

export function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

export function renderPrompt(template, values) {
  return Object.entries(values).reduce((acc, [key, value]) => acc.replaceAll(`{{${key}}}`, String(value ?? "")), template);
}

export function pruneOldFiles(dir, retentionMs, nowMs = Date.now()) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const removed = [];
  for (const name of names) {
    const path = join(dir, name);
    try {
      if (nowMs - statSync(path).mtimeMs > retentionMs) {
        unlinkSync(path);
        removed.push(name);
      }
    } catch {}
  }
  return removed;
}

export function sessionIdFor(prefix, key) {
  return `${prefix}${key}`;
}

export function isRetained(nowMs, mtimeMs, retentionMs = RETENTION_MS) {
  return nowMs - mtimeMs <= retentionMs;
}

export function createQueue({ maxWorkers, queueDepth, onBusy }) {
  const running = new Set();
  const pending = [];
  let counter = 0;

  function drain() {
    while (running.size < maxWorkers && pending.length) {
      const job = pending.shift();
      const id = ++counter;
      running.add(id);
      Promise.resolve()
        .then(job.fn)
        .catch(() => {})
        .finally(() => {
          running.delete(id);
          drain();
        });
    }
  }

  return {
    submit(label, fn) {
      if (running.size >= maxWorkers && pending.length >= queueDepth) {
        onBusy?.(label);
        return "rejected";
      }
      pending.push({ label, fn });
      drain();
      return "accepted";
    },
    stats() {
      return { running: running.size, pending: pending.length };
    },
  };
}

export function createCore({ adapter, paths, deps = {} }) {
  const now = deps.now ?? (() => Date.now());
  const spawn = deps.spawn ?? spawnProcess;
  const log = deps.log ?? defaultLog;
  const state = readJsonOr(paths.stateFile, emptyState());
  const children = new Map();
  const notes = new Map();
  const logDir = join(paths.logDir, adapter.name);
  mkdirSync(logDir, { recursive: true });

  function save() {
    mkdirSync(paths.stateFile.slice(0, paths.stateFile.lastIndexOf("/")), { recursive: true });
    writeJsonAtomic(paths.stateFile, state);
  }

  function appendLog(record) {
    try {
      appendFileSync(join(logDir, `${new Date(now()).toISOString().slice(0, 10)}.jsonl`), `${JSON.stringify({ ts: new Date(now()).toISOString(), ...record })}\n`);
    } catch {}
  }

  function hasSession(session) {
    try {
      return readdirSync(paths.sessionsDir).some((file) => file.endsWith(`_${session}.jsonl`));
    } catch {
      return false;
    }
  }

  function promptTemplate() {
    try {
      return readFileSync(paths.promptFile, "utf8");
    } catch {
      return "{{user_message}}";
    }
  }

  const queue = createQueue({
    maxWorkers: adapter.maxWorkers,
    queueDepth: adapter.queueDepth,
    onBusy: (label) => log("ignore", "queue-full", label),
  });

  function runWorker(inbound, entry) {
    const full = !hasSession(entry.session);
    const prompt = full
      ? renderPrompt(promptTemplate(), {
          conversation: inbound.key,
          chat_id: inbound.chatId,
          user_message: inbound.text,
          root_text: entry.rootText ?? inbound.text,
          platform: adapter.name,
          reply_rules: adapter.replyRules ?? "",
        })
      : inbound.text;
    const args = adapter.worker === "stub" ? ["-e", `console.log("[stub] session=${entry.session} full=${full}")`] : ["--print", "--session-id", entry.session, "--", prompt];
    const bin = adapter.worker === "stub" ? process.execPath : adapter.piBin;
    const command = adapter.buildWorker ? adapter.buildWorker({ prompt, full, session: entry.session }) : { bin, args };
    const started = now();
    appendLog({ event: "dispatch", key: inbound.key, session: entry.session, full });

    return new Promise((resolve) => {
      const child = spawn(command.bin, command.args, {
        cwd: paths.cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: `${join(paths.home, ".volta/bin")}:${join(paths.home, ".bun/bin")}:${process.env.PATH ?? ""}` },
      });
      let stdout = "";
      let stderr = "";
      let killed = false;
      children.set(inbound.key, child);
      const timer = setTimeout(() => {
        killed = true;
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }, adapter.timeoutMs);
      adapter.onProgress?.(inbound);
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", (error) => stderr += `${error}\n`);
      child.on("close", async (code) => {
        clearTimeout(timer);
        children.delete(inbound.key);
        appendLog({ event: "done", key: inbound.key, session: entry.session, exit: code, killed, elapsedMs: now() - started });
        const body = stdout.trim();
        const note = notes.get(inbound.key);
        notes.delete(inbound.key);
        const text = note
          ? note
          : killed
            ? `已终止：本轮超过 ${Math.round(adapter.timeoutMs / 60_000)} 分钟未结束。\n\n${body.slice(-1500)}`.trim()
            : body || `[无输出] exit=${code}\n${stderr.trim().split("\n").slice(-10).join("\n")}`;
        for (const part of chunkText(text, adapter.chunkLimit)) {
          try {
            await adapter.reply(inbound, part);
          } catch (error) {
            log("error", "reply", String(error?.message ?? error));
            break;
          }
        }
        adapter.onProgressDone?.(inbound);
        resolve();
      });
    });
  }

  async function handle(inbound) {
    if (adapter.allowedUser && inbound.authorId && inbound.authorId !== adapter.allowedUser) {
      log("ignore", "author", inbound.authorId);
      return "ignored";
    }
    if (state.seen[inbound.dedupeId]) {
      log("ignore", "duplicate", inbound.dedupeId);
      return "duplicate";
    }
    state.seen[inbound.dedupeId] = new Date(now()).toISOString();
    for (const key of Object.keys(state.seen)) {
      if (Object.keys(state.seen).length > 5000) delete state.seen[key];
    }
    const entry = state.convs[inbound.key] ?? { session: inbound.session, rootText: inbound.rootText ?? inbound.text, lastMsgTs: null };
    entry.lastMsgTs = new Date(now()).toISOString();
    if (!entry.rootText) entry.rootText = inbound.rootText ?? inbound.text;
    state.convs[inbound.key] = entry;
    save();

    const outcome = queue.submit(inbound.key, () => runWorker(inbound, entry));
    if (outcome === "rejected") {
      try {
        await adapter.reply(inbound, "当前繁忙：已有任务在跑且排队已满，稍后再发一次。");
      } catch (error) {
        log("error", "busy-reply", String(error?.message ?? error));
      }
      return "busy";
    }
    appendLog({ event: "accepted", key: inbound.key, session: entry.session });
    return "accepted";
  }

  function cancel(key, note = "已按指令终止本轮") {
    const child = children.get(key);
    if (!child) return false;
    notes.set(key, note);
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
    return true;
  }

  return {
    state,
    save,
    handle,
    cancel,
    stats: () => queue.stats(),
    pruneLogs: () => pruneOldFiles(logDir, RETENTION_MS, now()),
    log,
  };
}
