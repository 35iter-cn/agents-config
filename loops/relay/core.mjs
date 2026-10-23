#!/usr/bin/env bun
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn as spawnProcess } from "node:child_process";
import { join } from "node:path";
import { chunkText } from "./chunk.mjs";
import { createJob, isFinished } from "./jobs.mjs";

const RETENTION_MS = 72 * 3_600_000;
const SEEN_RETENTION_MS = 72 * 3_600_000;
const MAX_SEEN = 5000;

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
  return { cursor: null, seen: {}, convs: {}, alerts: {}, meta: { schemaVersion: 2 }, jobs: {}, inbox: [] };
}

export function upgradeState(state) {
  const next = state ?? emptyState();
  next.seen = next.seen ?? {};
  next.convs = next.convs ?? {};
  next.alerts = next.alerts ?? {};
  next.meta = next.meta ?? {};
  next.jobs = next.jobs ?? {};
  next.inbox = next.inbox ?? [];
  if (next.meta.schemaVersion !== 2) {
    for (const [dedupeId, value] of Object.entries(next.seen)) {
      if (!next.jobs[value]) next.seen[dedupeId] = "legacy";
    }
    for (const entry of Object.values(next.convs)) {
      if (entry && entry.activeJob === undefined) entry.activeJob = null;
    }
    next.meta.schemaVersion = 2;
  }
  return next;
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

export function createCore({ adapter, paths, deps = {} }) {
  const now = deps.now ?? (() => Date.now());
  const spawn = deps.spawn ?? spawnProcess;
  const log = deps.log ?? defaultLog;
  const state = upgradeState(readJsonOr(paths.stateFile, emptyState()));
  const children = new Map();
  const notes = new Map();
  const runtimeInbounds = new Map();
  const running = new Set();
  const logDir = join(paths.logDir, adapter.name);
  mkdirSync(logDir, { recursive: true });

  const isoNow = () => new Date(now()).toISOString();

  function save() {
    mkdirSync(paths.stateFile.slice(0, paths.stateFile.lastIndexOf("/")), { recursive: true });
    writeJsonAtomic(paths.stateFile, state);
  }

  function appendLog(record) {
    try {
      appendFileSync(join(logDir, `${isoNow().slice(0, 10)}.jsonl`), `${JSON.stringify({ ts: isoNow(), ...record })}\n`);
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

  function pruneSeen() {
    const ids = Object.keys(state.seen);
    if (!ids.length) return;
    const cutoff = now() - SEEN_RETENTION_MS;
    for (const dedupeId of ids) {
      const value = state.seen[dedupeId];
      const job = value === "legacy" ? null : state.jobs[value];
      if (job && !isFinished(job)) continue;
      const stamp = job ? Date.parse(job.updatedAt) : 0;
      if (job && Number.isFinite(stamp) && stamp > cutoff) continue;
      if (ids.length > MAX_SEEN || (job && Number.isFinite(stamp) && stamp <= cutoff)) {
        delete state.seen[dedupeId];
      }
    }
  }

  function runtimeInbound(job) {
    let inbound = runtimeInbounds.get(job.id);
    if (!inbound) {
      inbound = { ...job.inbound, key: job.key, session: job.session };
      runtimeInbounds.set(job.id, inbound);
    }
    return inbound;
  }

  function execute(job, entry) {
    const inbound = runtimeInbound(job);
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
    appendLog({ event: "dispatch", job: job.id, key: inbound.key, session: entry.session, full });

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
        appendLog({ event: "done", job: job.id, key: inbound.key, session: entry.session, exit: code, killed, elapsedMs: now() - started });
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
        job.status = note ? "cancelled" : killed || code !== 0 ? "failed" : "done";
        job.updatedAt = isoNow();
        runtimeInbounds.delete(job.id);
        resolve();
      });
    });
  }

  function startJob(job) {
    const entry = state.convs[job.key] ?? { session: job.session, rootText: job.inbound.rootText, lastMsgTs: null, activeJob: null };
    entry.activeJob = job.id;
    state.convs[job.key] = entry;
    job.status = "running";
    job.updatedAt = isoNow();
    running.add(job.id);
    save();
    execute(job, entry)
      .catch((error) => {
        log("error", "execute", String(error?.message ?? error));
        job.status = "failed";
        job.error = String(error?.message ?? error);
      })
      .finally(() => {
        running.delete(job.id);
        if (entry.activeJob === job.id) entry.activeJob = null;
        job.updatedAt = isoNow();
        runtimeInbounds.delete(job.id);
        save();
        drainInbox();
      });
  }

  function keyIsBusy(key) {
    const activeId = state.convs[key]?.activeJob;
    if (!activeId) return false;
    const holder = state.jobs[activeId];
    return Boolean(holder) && !isFinished(holder);
  }

  function drainInbox() {
    while (running.size < adapter.maxWorkers) {
      const index = state.inbox.findIndex((id) => {
        const job = state.jobs[id];
        if (!job || job.status !== "queued") return false;
        return !keyIsBusy(job.key);
      });
      if (index < 0) return;
      const [jobId] = state.inbox.splice(index, 1);
      startJob(state.jobs[jobId]);
    }
  }

  async function handle(inbound) {
    if (adapter.allowedUser && inbound.authorId && inbound.authorId !== adapter.allowedUser) {
      log("ignore", "author", inbound.authorId);
      return "ignored";
    }
    const known = state.seen[inbound.dedupeId];
    if (known === "legacy") {
      log("ignore", "duplicate-legacy", inbound.dedupeId);
      return "duplicate";
    }
    const existing = known ? state.jobs[known] : null;
    if (existing && !isFinished(existing)) {
      log("ignore", "duplicate-in-flight", existing.id);
      return "accepted";
    }
    if (known) {
      log("ignore", "duplicate", inbound.dedupeId);
      return "duplicate";
    }

    const job = createJob(state, inbound, isoNow);
    state.jobs[job.id] = job;
    state.inbox.push(job.id);
    state.seen[inbound.dedupeId] = job.id;
    const entry = state.convs[job.key] ?? { session: job.session, rootText: job.inbound.rootText, lastMsgTs: null, activeJob: null };
    if (!entry.activeJob) entry.activeJob = null;
    entry.lastMsgTs = job.createdAt;
    if (!entry.rootText) entry.rootText = job.inbound.rootText;
    state.convs[job.key] = entry;
    pruneSeen();
    save();
    appendLog({ event: "accepted", job: job.id, key: job.key, session: job.session });

    if (running.size >= adapter.maxWorkers && state.inbox.length > adapter.queueDepth) {
      state.inbox = state.inbox.filter((id) => id !== job.id);
      job.status = "failed";
      job.error = "queue-full";
      job.updatedAt = isoNow();
      delete state.seen[inbound.dedupeId];
      save();
      log("ignore", "queue-full", job.id);
      try {
        await adapter.reply(runtimeInbound(job), "当前繁忙：已有任务在跑且排队已满，稍后再发一次。");
      } catch (error) {
        log("error", "busy-reply", String(error?.message ?? error));
      }
      return "busy";
    }

    drainInbox();
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
    stats: () => ({ running: running.size, pending: state.inbox.length }),
    pruneLogs: () => pruneOldFiles(logDir, RETENTION_MS, now()),
    log,
  };
}
