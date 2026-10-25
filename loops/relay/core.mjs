#!/usr/bin/env bun
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn as spawnProcess } from "node:child_process";
import { join } from "node:path";
import { chunkText } from "./chunk.mjs";
import { createJob, ctxOf, hashOf, isFinished, nextAction, planParts, readProcStartTicks } from "./jobs.mjs";

const HEARTBEAT_MS = 15_000;
const LEASE_TTL_MS = 45_000;

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

export const CANDIDATE_LINE = /^[ \t]*\[\d{8}-\d{4}-\d+\][ \t]+\S/m;

export function createCore({ adapter, paths, deps = {} }) {
  const now = deps.now ?? (() => Date.now());
  const spawn = deps.spawn ?? spawnProcess;
  const readStartTicks = deps.readStartTicks ?? readProcStartTicks;
  const kill = deps.kill ?? ((target, signal) => process.kill(target, signal));
  const log = deps.log ?? defaultLog;
  const jev = deps.jev ?? null;
  const usage = deps.usage ?? null;
  const loadedState = readJsonOr(paths.stateFile, null);
  const needsUpgrade = !loadedState?.meta?.schemaVersion;
  const state = upgradeState(loadedState ?? emptyState());
  const children = new Map();
  const notes = new Map();
  const runtimeInbounds = new Map();
  const running = new Set();
  const logDir = join(paths.logDir, adapter.name);
  mkdirSync(logDir, { recursive: true });

  const isoNow = () => new Date(now()).toISOString();

  if (needsUpgrade) {
    mkdirSync(paths.stateFile.slice(0, paths.stateFile.lastIndexOf("/")), { recursive: true });
    writeJsonAtomic(paths.stateFile, state);
  }

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

  function rootSectionText(root, message) {
    const value = String(root ?? "").trim();
    if (!value) return "";
    if (value === String(message ?? "").trim()) return "";
    return `\n本会话的起点（不是你这条）：\n${value}`;
  }

  function candidateRulesText() {
    try {
      return readFileSync(paths.candidateRulesFile, "utf8").trim();
    } catch (error) {
      log("warn", "candidate-rules", String(error?.message ?? error));
      return "";
    }
  }

  function regexVariant(root) {
    return CANDIDATE_LINE.test(root) ? "candidate_rules" : "task_skeleton";
  }

  function renderPromptFor(inbound, entry, variant) {
    const root = entry.rootText || inbound.text;
    const rules = variant === "candidate_rules" ? candidateRulesText() : "";
    return renderPrompt(promptTemplate(), {
      platform: adapter.name,
      surface: adapter.surface ?? "本会话",
      conversation: inbound.key,
      chat_id: inbound.chatId,
      user_message: inbound.text,
      root_section: rootSectionText(root, inbound.text),
      reply_rules: adapter.replyRules ?? "",
      chunk_limit: adapter.chunkLimit,
      candidate_rules: rules ? `\n\n${rules}` : "",
    });
  }

  function buildPrompt(inbound, entry) {
    const root = entry.rootText || inbound.text;
    if (typeof jev?.judgeChoice !== "function") return renderPromptFor(inbound, entry, regexVariant(root));
    return jev.judgeChoice({
      id: "prompt-variant",
      state: root,
      instructions: "要给这条消息拼装 prompt 模板，应该选哪个变体？",
      criteria: {
        candidate_rules: "在播报新候选任务，带候选编号或任务链接",
        task_skeleton: "用户在给指令、表态或提问，不是播报候选",
      },
    }).then((verdict) => renderPromptFor(inbound, entry, verdict?.choice ?? regexVariant(root)));
  }

  function execute(job, entry) {
    const inbound = runtimeInbound(job);
    const full = !hasSession(entry.session);
    if (!full) return spawnWorker(job, entry, inbound, inbound.text, false);
    const built = buildPrompt(inbound, entry);
    if (typeof built?.then === "function") return built.then((prompt) => spawnWorker(job, entry, inbound, prompt, true));
    return spawnWorker(job, entry, inbound, built, true);
  }

  function spawnWorker(job, entry, inbound, prompt, full) {
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
      job.lease = { pid: child.pid ?? null, startTicks: child.pid ? readStartTicks(child.pid) : null, startedAt: now(), heartbeatAt: now() };
      job.startedAt = started;
      job.updatedAt = isoNow();
      save();
      const heartbeat = setInterval(() => {
        if (job.status !== "running" || !job.lease) return;
        job.lease.heartbeatAt = now();
        save();
      }, HEARTBEAT_MS);
      heartbeat.unref?.();
      const timer = setTimeout(() => {
        killed = true;
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }, adapter.timeoutMs);
      const progressPromise = Promise.resolve(adapter.onProgress?.(ctxOf(job))).then((progress) => {
        if (!progress) return;
        job.progress = progress;
        job.updatedAt = isoNow();
        save();
      }).catch((error) => log("warn", "progress", String(error?.message ?? error)));
      void progressPromise;
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", (error) => stderr += `${error}\n`);
      child.on("close", async (code) => {
        clearTimeout(timer);
        clearInterval(heartbeat);
        children.delete(inbound.key);
        appendLog({ event: "done", job: job.id, key: inbound.key, session: entry.session, exit: code, killed, elapsedMs: now() - started });
        const body = stdout.trim();
        const note = notes.get(inbound.key);
        notes.delete(inbound.key);
        const text = note
          ? note
          : killed
            ? `已终止：本轮超过 ${Math.round(adapter.timeoutMs / 60_000)} 分钟未结束。回复「继续」可以接着做，前面已完成的改动都在。\n\n${body.slice(-1500)}`.trim()
            : body || `[无输出] exit=${code}\n${stderr.trim().split("\n").slice(-10).join("\n")}`;
        job.answer = text;
        job.status = note ? "cancelled" : killed || code !== 0 ? "failed" : "answered";
        job.lease = null;
        job.updatedAt = isoNow();
        save();
        await deliver(job);
        usage?.recordRun({
          job,
          platform: adapter.name,
          key: inbound.key,
          session: entry.session,
          answer: text,
          status: job.status,
          startedAt: job.startedAt ?? Date.parse(job.createdAt),
        });
        runtimeInbounds.delete(job.id);
        resolve();
      });
    });
  }

  async function deliver(job) {
    const canEdit = typeof adapter.edit === "function";
    const plan = planParts({ answer: job.answer ?? "", parts: job.parts, chunkLimit: adapter.chunkLimit, canEdit });
    let failed = false;
    for (const step of plan) {
      if (step.action === "skip") continue;
      try {
        if (step.action === "edit") {
          const ok = await adapter.edit(ctxOf(job), step.messageId, step.text);
          if (!ok) {
            log("warn", "edit-skip", job.id, step.i);
            continue;
          }
          job.parts = [...job.parts.filter((part) => part.i !== step.i), { i: step.i, messageId: step.messageId, hash: hashOf(step.text), sentAt: isoNow() }];
        } else {
          const sent = await adapter.reply(ctxOf(job), step.text);
          job.parts = [...job.parts.filter((part) => part.i !== step.i), { i: step.i, messageId: sent?.messageId ?? null, hash: hashOf(step.text), sentAt: isoNow() }];
        }
        job.updatedAt = isoNow();
        save();
      } catch (error) {
        log("error", "reply", String(error?.message ?? error));
        failed = true;
        break;
      }
    }
    try {
      await adapter.onProgressDone?.(ctxOf(job));
    } catch (error) {
      log("warn", "progress-done", String(error?.message ?? error));
    }
    if (!failed && job.status === "answered") {
      job.status = "done";
      job.answer = undefined;
    }
    job.updatedAt = isoNow();
    save();
    return job.status;
  }

  function startJob(job) {
    const entry = state.convs[job.key] ?? { session: job.session, rootText: job.inbound.rootText, lastMsgTs: null, activeJob: null };
    entry.activeJob = job.id;
    state.convs[job.key] = entry;
    job.status = "running";
    job.lease = { pid: null, startTicks: null, startedAt: now(), heartbeatAt: now() };
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

  function parseCommand(text) {
    const trimmed = String(text ?? "").trim();
    const lower = trimmed.toLowerCase();
    if (lower === "停" || lower === "stop" || /^\/stop(@\w+)?$/.test(lower)) return "stop";
    if (trimmed === "重跑" || /^\/重跑$/.test(trimmed) || /^\/rerun(@\w+)?$/i.test(trimmed)) return "retry";
    return null;
  }

  function ctxFor(inbound, job) {
    if (job) return ctxOf(job);
    return {
      jobId: null,
      key: inbound.key,
      chatId: inbound.chatId ?? null,
      messageId: inbound.messageId ?? null,
      threadId: inbound.threadId ?? null,
      replyTo: inbound.replyTo ?? null,
      progress: null,
      text: inbound.text,
      rootText: inbound.rootText ?? inbound.text,
    };
  }

  async function runStop(inbound) {
    const activeId = state.convs[inbound.key]?.activeJob;
    const job = activeId ? state.jobs[activeId] : null;
    const cancelled = cancel(inbound.key);
    if (job && job.status === "running") {
      job.status = "cancelled";
      job.lease = null;
      job.updatedAt = isoNow();
    }
    state.seen[inbound.dedupeId] = "legacy";
    save();
    appendLog({ event: "stop", key: inbound.key, cancelled, job: job?.id ?? null });
    if (!cancelled) {
      try {
        await adapter.reply(ctxFor(inbound, job), "当前没有在跑的任务。");
      } catch (error) {
        log("error", "stop-reply", String(error?.message ?? error));
      }
    }
    return "accepted";
  }

  async function runRetry(inbound) {
    const target = Object.values(state.jobs)
      .filter((job) => job.key === inbound.key && job.status === "interrupted")
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    if (!target) {
      try {
        await adapter.reply(ctxFor(inbound, null), "这个会话没有可重跑的中断任务。");
      } catch (error) {
        log("error", "retry-reply", String(error?.message ?? error));
      }
      return "accepted";
    }
    const attempt = Number(target.attempts ?? 1) + 1;
    const retryInbound = {
      ...target.inbound,
      key: target.key,
      session: target.session,
      dedupeId: `${target.inbound.dedupeId}#retry${attempt - 1}`,
      authorId: inbound.authorId ?? target.inbound.authorId,
      chatId: inbound.chatId ?? target.inbound.chatId,
      messageId: inbound.messageId ?? target.inbound.messageId,
      threadId: inbound.threadId ?? target.inbound.threadId,
    };
    const job = createJob(state, retryInbound, isoNow);
    job.attempts = attempt;
    state.jobs[job.id] = job;
    state.inbox.push(job.id);
    state.seen[retryInbound.dedupeId] = job.id;
    state.seen[inbound.dedupeId] = job.id;
    target.retriedBy = job.id;
    target.updatedAt = isoNow();
    save();
    appendLog({ event: "retry", job: job.id, from: target.id, key: job.key });
    drainInbox();
    return "accepted";
  }

  const INTERRUPT_NOTICE = "上一轮处理被中断（进程重启）。回复「继续」接着做，或 /重跑 从头再来。";

  async function interrupt(job) {
    if (!job.noticeSent) {
      try {
        await adapter.reply(ctxOf(job), INTERRUPT_NOTICE);
      } catch (error) {
        log("error", "interrupt-reply", String(error?.message ?? error));
      }
      try {
        await adapter.onProgressDone?.(ctxOf(job));
      } catch (error) {
        log("warn", "progress-done", String(error?.message ?? error));
      }
      job.noticeSent = true;
    }
    job.status = "interrupted";
    job.lease = null;
    job.answer = undefined;
    job.progress = null;
    job.updatedAt = isoNow();
    save();
    appendLog({ event: "interrupted", job: job.id, key: job.key });
  }

  async function recover() {
    const at = now();
    const canEdit = typeof adapter.edit === "function";
    let touched = 0;
    for (const job of Object.values(state.jobs)) {
      if (isFinished(job) || job.status === "interrupted") {
        if (state.inbox.includes(job.id)) state.inbox = state.inbox.filter((id) => id !== job.id);
        continue;
      }
      const action = nextAction(job, { now: at, leaseTtlMs: LEASE_TTL_MS, canEdit, chunkLimit: adapter.chunkLimit, readStartTicks });
      if (action.type === "rerun") {
        if (!state.inbox.includes(job.id)) state.inbox.push(job.id);
        touched += 1;
        continue;
      }
      if (action.type === "reap-then-interrupt") {
        try {
          kill(-action.pid, "SIGKILL");
        } catch (error) {
          log("warn", "reap", String(error?.message ?? error));
        }
        await interrupt(job);
        touched += 1;
        continue;
      }
      if (action.type === "interrupt") {
        await interrupt(job);
        touched += 1;
        continue;
      }
      if (action.type === "resend") {
        await deliver(job);
        touched += 1;
        continue;
      }
      job.answer = undefined;
      job.progress = null;
      touched += 1;
    }
    if (touched) save();
    drainInbox();
    return touched;
  }

  async function handle(inbound) {
    if (adapter.allowedUser && inbound.authorId && inbound.authorId !== adapter.allowedUser) {
      log("ignore", "author", inbound.authorId);
      return "ignored";
    }
    const command = parseCommand(inbound.text);
    if (command) {
      const knownCommand = state.seen[inbound.dedupeId];
      if (knownCommand && knownCommand !== "legacy") {
        log("ignore", "duplicate-command", inbound.dedupeId);
        return "duplicate";
      }
      return command === "stop" ? runStop(inbound) : runRetry(inbound);
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
    recover,
    cancel,
    stats: () => ({ running: running.size, pending: state.inbox.length }),
    pruneLogs: () => pruneOldFiles(logDir, RETENTION_MS, now()),
    log,
  };
}
