#!/usr/bin/env bun

export const PLATFORMS = ["feishu", "slack", "telegram"];

const REQUIRED = { name: "string", start: "function", reply: "function" };
const OPTIONAL = ["notify", "edit", "onProgress", "onProgressDone"];

// Adapter contract (ctx is always a plain, JSON-serializable object):
//   start({ onMessage, onReady, core })
//   reply(ctx, text) -> { messageId } | null
//   edit?(ctx, messageId, text) -> boolean
//   onProgress?(ctx) -> progress object | null
//   onProgressDone?(ctx) -> void
// Adapters must not keep cross-call state: it lives in the job and arrives via ctx.
export function defineAdapter(adapter) {
  const missing = [];
  for (const [field, type] of Object.entries(REQUIRED)) {
    if (typeof adapter?.[field] !== type) missing.push(`${field}:${type}`);
  }
  for (const field of OPTIONAL) {
    if (adapter?.[field] !== undefined && typeof adapter[field] !== "function") missing.push(`${field}:function`);
  }
  if (missing.length) throw new Error(`adapter contract violated: ${missing.join(", ")}`);
  if (!PLATFORMS.includes(adapter.name)) throw new Error(`unknown platform: ${adapter.name}`);
  return adapter;
}

export function isPlatform(name) {
  return PLATFORMS.includes(name);
}
