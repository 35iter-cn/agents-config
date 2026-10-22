#!/usr/bin/env bun

export const PLATFORMS = ["feishu", "slack", "telegram"];

const REQUIRED = { name: "string", start: "function", reply: "function" };
const OPTIONAL = ["notify", "onProgress", "onProgressDone"];

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
