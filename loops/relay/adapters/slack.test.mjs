import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { stripMentions, isStop, sessionFor, acceptsEvent, heartbeatVerdict, refreshDelayMs, alertAllowed, pruneThreads, defaults } from "./slack.mjs";

const base = { channel: defaults.channel, ts: "1792558469.808939", text: "帮我扫一下 <@U0A5T8AR9EU>", user: defaults.allowedUser };

test("mentions are stripped from the message text", () => {
  assert.equal(stripMentions("<@U0A5T8AR9EU> 帮我扫一下"), "帮我扫一下");
  assert.equal(stripMentions("   "), "");
});

test("threads map to dot-free session names", () => {
  assert.equal(sessionFor("1792558469.808939"), "slack-1792558469808939");
});

test("TC-10 the bot's own messages are ignored", () => {
  assert.deepEqual(acceptsEvent({ ...base, bot_id: "B123" }, {}), { ok: false, why: "bot" });
  assert.deepEqual(acceptsEvent({ ...base, user: defaults.botUser }, {}), { ok: false, why: "bot" });
});

test("TC-10 only the allowed author in the configured channel is accepted", () => {
  assert.deepEqual(acceptsEvent({ ...base, user: "U-stranger" }, {}), { ok: false, why: "author" });
  assert.deepEqual(acceptsEvent({ ...base, channel: "C-other" }, {}), { ok: false, why: "channel" });
  assert.deepEqual(acceptsEvent({ ...base, text: "   " }, {}), { ok: false, why: "empty-text" });
  assert.deepEqual(acceptsEvent(null, {}), { ok: false, why: "empty" });
});

test("thread replies join the parent thread, top-level messages start one", () => {
  const reply = acceptsEvent({ ...base, thread_ts: "1792558000.000100" }, {});
  assert.equal(reply.ok, true);
  assert.equal(reply.thread, "1792558000.000100");
  const top = acceptsEvent(base, {});
  assert.equal(top.thread, base.ts);
});

test("subtypes that carry real content are accepted, others ignored", () => {
  assert.equal(acceptsEvent({ ...base, subtype: "thread_broadcast" }, {}).ok, true);
  assert.equal(acceptsEvent({ ...base, subtype: "file_share" }, {}).ok, true);
  assert.deepEqual(acceptsEvent({ ...base, subtype: "channel_join" }, {}), { ok: false, why: "subtype" });
});

test("TC-11 a missing server ping terminates the connection", () => {
  const now = 1_000_000;
  assert.equal(heartbeatVerdict({ lastServerPingAt: now - 31_000, lastPongAt: now }, now), "no-server-ping");
  assert.equal(heartbeatVerdict({ lastServerPingAt: now - 5_000, lastPongAt: now }, now), null);
});

test("TC-11 a missing pong terminates the connection", () => {
  const now = 1_000_000;
  assert.equal(heartbeatVerdict({ lastServerPingAt: now - 1_000, lastPongAt: now - 11_000 }, now), "no-pong");
  assert.equal(heartbeatVerdict({ lastServerPingAt: now - 1_000, lastPongAt: now - 2_000 }, now), null);
  assert.equal(heartbeatVerdict({ lastServerPingAt: now - 1_000, lastPongAt: null }, now), null);
});

test("TC-11 the connection rotates at 80% of its announced lifetime", () => {
  assert.equal(refreshDelayMs(600_000), 480_000);
  assert.equal(refreshDelayMs(10_000), 60_000);
  assert.equal(refreshDelayMs(600_000, 120_000), 120_000);
});

test("alerts respect the cooldown window", () => {
  assert.equal(alertAllowed({}, "stale", 1_000_000), true);
  assert.equal(alertAllowed({ stale: new Date(1_000_000).toISOString() }, "stale", 1_060_000), false);
  assert.equal(alertAllowed({ stale: new Date(1_000_000).toISOString() }, "stale", 1_000_000 + 31 * 60_000), true);
});

test("threads older than the retention window are pruned", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  const pruned = pruneThreads(
    {
      old: { lastMsgTs: "2026-09-01T00:00:00Z" },
      fresh: { lastMsgTs: "2026-10-22T11:00:00Z" },
      unknown: {},
    },
    now,
  );
  assert.deepEqual(Object.keys(pruned), ["fresh", "unknown"]);
});

test("stop words cancel only the exact match", () => {
  assert.equal(isStop("停"), true);
  assert.equal(isStop(" stop "), true);
  assert.equal(isStop("停一下再看看"), false);
});

test("slack announces readiness once and only from the start scope", () => {
  const source = readFileSync(new URL("./slack.mjs", import.meta.url), "utf8");
  const helloBlock = source.slice(source.indexOf('if (envelope.type === "hello")'), source.indexOf('if (envelope.type === "disconnect")'));
  assert.doesNotMatch(helloBlock, /onReady/);
  assert.match(source, /let readyAnnounced = false;/);
  assert.match(source, /if \(!readyAnnounced\) \{/);
});
