#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chunkText } from "./chunk.mjs";

export const DEFAULT_LEASE_TTL_MS = 45_000;
export const FINISHED_STATUSES = new Set(["done", "failed", "cancelled"]);

export function hashOf(text) {
  return createHash("sha256").update(String(text)).digest("hex").slice(0, 16);
}

export function isFinished(job) {
  return FINISHED_STATUSES.has(job?.status);
}

export function createJob(state, inbound, nowIso = () => new Date().toISOString()) {
  state.meta = state.meta ?? {};
  const seq = Number(state.meta.jobSeq ?? 0) + 1;
  state.meta.jobSeq = seq;
  const at = nowIso();
  return {
    id: `job-${seq}`,
    key: inbound.key,
    session: inbound.session,
    status: "queued",
    inbound: {
      text: inbound.text,
      rootText: inbound.rootText ?? inbound.text,
      chatId: inbound.chatId ?? null,
      authorId: inbound.authorId ?? null,
      dedupeId: inbound.dedupeId,
      messageId: inbound.messageId ?? null,
      threadId: inbound.threadId ?? null,
      replyTo: inbound.replyTo ?? null,
      channelPost: inbound.channelPost ?? null,
    },
    answer: null,
    parts: [],
    progress: null,
    lease: null,
    noticeSent: false,
    retriedBy: null,
    attempts: 1,
    createdAt: at,
    updatedAt: at,
    error: null,
  };
}

export function readProcStartTicks(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return afterComm[19] ?? null;
  } catch {
    return null;
  }
}

export function isLeaseAlive(lease, now, ttlMs = DEFAULT_LEASE_TTL_MS, readStartTicks = readProcStartTicks) {
  if (!lease?.pid) return false;
  if (!Number.isFinite(lease.heartbeatAt) || now - lease.heartbeatAt > ttlMs) return false;
  const ticks = readStartTicks(lease.pid);
  return ticks != null && ticks === lease.startTicks;
}

export function planParts({ answer, parts = [], chunkLimit, canEdit = false }) {
  if (answer == null) return [];
  return chunkText(String(answer), chunkLimit).map((text, i) => {
    const sent = parts.find((part) => part.i === i);
    if (!sent) return { i, text, action: "send" };
    if (sent.hash === hashOf(text)) return { i, action: "skip" };
    if (canEdit && sent.messageId) return { i, text, action: "edit", messageId: sent.messageId };
    return { i, action: "skip" };
  });
}

export function nextAction(job, { now, leaseTtlMs = DEFAULT_LEASE_TTL_MS, canEdit = false, chunkLimit, readStartTicks } = {}) {
  switch (job.status) {
    case "queued":
      return { type: "rerun" };
    case "running":
      return isLeaseAlive(job.lease, now, leaseTtlMs, readStartTicks)
        ? { type: "reap-then-interrupt", pid: job.lease.pid }
        : { type: "interrupt" };
    case "answered":
      return { type: "resend", parts: planParts({ answer: job.answer, parts: job.parts, chunkLimit, canEdit }) };
    default:
      return { type: "finish" };
  }
}

export function ctxOf(job) {
  return {
    jobId: job.id,
    key: job.key,
    chatId: job.inbound.chatId,
    messageId: job.inbound.messageId,
    threadId: job.inbound.threadId,
    channelPost: job.inbound.channelPost,
    replyTo: job.inbound.replyTo ?? job.parts.at(-1)?.messageId ?? null,
    progress: job.progress,
    text: job.inbound.text,
    rootText: job.inbound.rootText,
  };
}
