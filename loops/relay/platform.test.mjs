import test from "node:test";
import assert from "node:assert/strict";
import { defineAdapter, isPlatform, PLATFORMS } from "./platform.mjs";

test("three platforms are registered", () => {
  assert.deepEqual(PLATFORMS, ["feishu", "slack", "telegram"]);
  assert.equal(isPlatform("slack"), true);
  assert.equal(isPlatform("matrix"), false);
});

test("an adapter without the required surface is rejected", () => {
  assert.throws(() => defineAdapter({ name: "feishu", start: () => {} }), /reply:function/);
  assert.throws(() => defineAdapter({ name: "unknown", start: () => {}, reply: () => {} }), /unknown platform/);
  assert.throws(() => defineAdapter(null), /adapter contract violated/);
});

test("a complete adapter passes and is returned as-is", () => {
  const adapter = { name: "slack", start: () => {}, reply: () => {}, notify: () => {} };
  assert.equal(defineAdapter(adapter), adapter);
});
