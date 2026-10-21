#!/usr/bin/env bun
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HOME = process.env.HOME;
const ROOT = dirname(fileURLToPath(import.meta.url));
const CFG_DIR = join(HOME, ".config/taskradar");
const LOG_DIR = join(CFG_DIR, "logs/tgd");
const ENV_FILE = join(CFG_DIR, "telegram.env");
const STATE_FILE = join(CFG_DIR, "tgd.json");
const HOME_CODE = join(HOME, "code");
const PI = join(HOME, ".bun/bin/pi");
const PROJECT_DIR = join(HOME, ".pi/agent/sessions", `--${HOME_CODE.replace(/^\//, "").replace(/[\/\\:]/g, "-")}--`);
const STATE_PATH = process.env.TASKRADAR_STATE ?? join(CFG_DIR, "state.json");
const MAX_WORKERS = Number(process.env.TGD_MAX_WORKERS ?? 2);
const QUEUE_DEPTH = Number(process.env.TGD_QUEUE_DEPTH ?? 3);
const TURN_TIMEOUT_MS = Number(process.env.TGD_TIMEOUT_MS ?? 90 * 60_000);
const WAIT_TIMEOUT_MS = Number(process.env.TGD_WAIT_MS ?? 90 * 60_000);
const TYPING_REFRESH_MS = Number(process.env.TGD_TYPING_MS ?? 4_000);
const LOG_RETENTION_MS = 72 * 3_600_000;
const CONV_RETENTION_MS = 30 * 86_400_000;
const MESSAGE_LIMIT = 4000;
const POLL_TIMEOUT_S = Number(process.env.TGD_POLL_TIMEOUT ?? 25);
const ALERT_COOLDOWN_MS = Number(process.env.TGD_ALERT_COOLDOWN_MS ?? 30 * 60_000);
const PRUNE_INTERVAL_MS = 86_400_000;
const RAW_LOG = process.env.TGD_RAW_LOG === "1";
const STOP_WORDS = ["停", "stop"];

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

function readJsonOr(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    if (existsSync(file)) {
      try {
        renameSync(file, `${file}.bad`);
      } catch (e2) {
        process.stderr.write(`tgd: cannot quarantine ${file}: ${e2}\n`);
      }
    }
    return fallback;
  }
}

function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function logFile() {
  return join(LOG_DIR, `tgd-${new Date().toISOString().slice(0, 10)}.jsonl`);
}

function log(level, ...parts) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" "),
  });
  process.stderr.write(`${line}\n`);
  try {
    appendFileSync(logFile(), `${line}\n`);
  } catch (e) {
    process.stderr.write(`tgd: log write failed: ${e}\n`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pruneDir(dir, maxAgeMs) {
  let removed = 0;
  try {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      try {
        if (Date.now() - statSync(path).mtimeMs > maxAgeMs) {
          unlinkSync(path);
          removed += 1;
        }
      } catch (e) {
        log("warn", "prune", path, String(e));
      }
    }
  } catch (e) {
    log("warn", "prune", dir, String(e));
  }
  return removed;
}

function isStop(text) {
  return STOP_WORDS.includes(text.trim().toLowerCase());
}

function sessionName(conversation) {
  return `tg-${conversation}`;
}

function hasSession(session) {
  try {
    return readdirSync(PROJECT_DIR).some((f) => f.endsWith(`_${session}.jsonl`));
  } catch (e) {
    log("warn", "hasSession", String(e));
    return false;
  }
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function toTelegramHtml(text) {
  const parts = text.split("```");
  let out = "";
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      out += `<pre>${escapeHtml(part.replace(/^\n/, "").replace(/\n$/, ""))}</pre>`;
      return;
    }
    out += escapeHtml(part)
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  });
  return out;
}

function chunkText(text, limit = MESSAGE_LIMIT) {
  const chunks = [];
  let buf = "";
  for (const line of text.split("\n")) {
    const pieces = line.length > limit ? line.match(new RegExp(`[\\s\\S]{1,${limit}}`, "g")) : [line];
    for (const piece of pieces) {
      if (buf && buf.length + piece.length + 1 > limit) {
        chunks.push(buf);
        buf = "";
      }
      if (!buf) buf = piece.slice(0, limit);
      else buf = `${buf}\n${piece}`;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [""];
}

function pruneConversations(convs, alias, now = Date.now()) {
  const kept = {};
  for (const [key, value] of Object.entries(convs ?? {})) {
    const seen = Date.parse(value?.lastMsgTs ?? "");
    if (Number.isFinite(seen) && now - seen > CONV_RETENTION_MS) continue;
    kept[key] = value;
  }
  const keptAlias = {};
  for (const [msgId, key] of Object.entries(alias ?? {})) {
    if (kept[key]) keptAlias[msgId] = key;
  }
  return { convs: kept, alias: keptAlias };
}

function alertAllowed(alerts, kind, now, cooldownMs = ALERT_COOLDOWN_MS) {
  const last = Date.parse(alerts?.[kind] ?? "");
  return !Number.isFinite(last) || now - last > cooldownMs;
}

function buildPrompt({ raw, chatId, conversation, topic, userMessage, rootText, root, statePath }) {
  return raw
    .replaceAll("{{chat_id}}", String(chatId))
    .replaceAll("{{conversation}}", String(conversation))
    .replaceAll("{{topic}}", topic ? String(topic) : "-")
    .replaceAll("{{user_message}}", userMessage)
    .replaceAll("{{root_text}}", rootText ?? "")
    .replaceAll("{{root}}", root)
    .replaceAll("{{state_path}}", statePath);
}

function runSelftest() {
  const { strictEqual, deepStrictEqual, ok } = assert;

  strictEqual(escapeHtml("a<b>&c"), "a&lt;b&gt;&amp;c");
  strictEqual(toTelegramHtml("**粗体** 和 `code`"), "<b>粗体</b> 和 <code>code</code>");
  strictEqual(toTelegramHtml("```\nconst a = 1 < 2;\n```"), "<pre>const a = 1 &lt; 2;</pre>");
  strictEqual(toTelegramHtml("a*b*c **x**"), "a*b*c <b>x</b>");

  const one = chunkText("x".repeat(9000), 4000);
  ok(one.length >= 3, `chunks ${one.length}`);
  ok(one.every((c) => c.length <= 4000));
  deepStrictEqual(chunkText("a\nb", 4000), ["a\nb"]);
  deepStrictEqual(chunkText("", 4000), [""]);
  const long = chunkText(`${"y".repeat(5000)}\nz`, 4000);
  ok(long.every((c) => c.length <= 4000));

  strictEqual(channelKey(8), "ch8");
  strictEqual(sessionName(channelKey(8)), "tg-ch8");
  const channelPosts = { "7": { mirrorId: 11, at: "x" }, "8": { mirrorId: 12, at: "x" } };
  strictEqual(resolveCommentKey(11, channelPosts), "ch7");
  strictEqual(resolveCommentKey(99, channelPosts), null);
  strictEqual(resolveCommentKey(null, channelPosts), null);
  strictEqual(
    channelPostIdFor({ reply_to_message: { is_automatic_forward: true, forward_from_message_id: 7 } }),
    7,
  );
  strictEqual(
    channelPostIdFor({ reply_to_message: { is_automatic_forward: true, forward_origin: { message_id: 9 } } }),
    9,
  );
  strictEqual(channelPostIdFor({ reply_to_message: { message_id: 13 } }), null);
  strictEqual(channelPostIdFor({}), null);
  strictEqual(
    channelPostIdFor({ message_id: 16, is_automatic_forward: true, forward_from_message_id: 10 }),
    10,
  );
  strictEqual(convTopic("ch7", { ch7: { topic: null } }, channelPosts), 11);
  strictEqual(convTopic("ch7", { ch7: { topic: 21 } }, channelPosts), 21);
  strictEqual(convTopic("ch99", {}, channelPosts), null);
  strictEqual(convTopic("2", { "2": { topic: null } }, channelPosts), null);

  ok(isStop(" 停 "));
  ok(isStop("STOP"));
  ok(!isStop("停下来"));

  strictEqual(turnLimitMinutes(90 * 60_000), 90);
  strictEqual(timeoutNote(90 * 60_000), "本轮超过 90 分钟，已被终止");
  strictEqual(timeoutNote(20 * 60_000), "本轮超过 20 分钟，已被终止");
  strictEqual(pickTypingTarget([], 0), null);
  strictEqual(pickTypingTarget(["a", "b"], 1), "b");
  strictEqual(pickTypingTarget(["a", "b"], 2), "a");

  strictEqual(sessionName(1234), "tg-1234");
  ok(sessionName(1234).match(/^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/));
  strictEqual(PROJECT_DIR, join(HOME, ".pi/agent/sessions", "--home-manooog-code--"));

  const pruned = pruneConversations(
    {
      1: { lastMsgTs: new Date(Date.now() - 40 * 86_400_000).toISOString() },
      2: { lastMsgTs: new Date().toISOString() },
    },
    { "100": "1", "200": "2" },
  );
  deepStrictEqual(Object.keys(pruned.convs), ["2"]);
  deepStrictEqual(pruned.alias, { "200": "2" });

  ok(alertAllowed({}, "poll", 1_000_000));
  ok(!alertAllowed({ poll: new Date(1_000_000).toISOString() }, "poll", 1_000_000 + 60_000));

  const prompt = buildPrompt({
    raw: readFileSync(join(ROOT, "prompts/thread.md"), "utf8"),
    chatId: -1001234567890,
    conversation: 42,
    topic: 7,
    userMessage: "扫一下 backend",
    rootText: "[20261021-1300-1] 候选 id",
    root: ROOT,
    statePath: STATE_PATH,
  });
  ok(!prompt.includes("{{"), "prompt placeholders all replaced");
  ok(prompt.includes("扫一下 backend"));
  ok(prompt.includes("[20261021-1300-1] 候选 id"));
  ok(prompt.includes("本会话的回帖只能靠 stdout"));

  const dir = join(tmpdir(), `tgd-selftest-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "old.jsonl"), "");
  writeFileSync(join(dir, "fresh.jsonl"), "");
  const old = new Date(Date.now() - 4 * 86_400_000);
  utimesSync(join(dir, "old.jsonl"), old, old);
  strictEqual(pruneDir(dir, LOG_RETENTION_MS), 1);
  deepStrictEqual(readdirSync(dir), ["fresh.jsonl"]);
  rmSync(dir, { recursive: true, force: true });

  process.stdout.write("selftest ok\n");
}

const mode = process.argv[2];

if (mode === "--selftest") {
  runSelftest();
  process.exit(0);
}

mkdirSync(LOG_DIR, { recursive: true });

const env = { ...readEnvFile(ENV_FILE), ...process.env };
const token = env.TELEGRAM_BOT_TOKEN;
const chatId = env.TELEGRAM_CHAT_ID;
const allowedUser = env.TELEGRAM_ALLOWED_USER;
const intakeTopic = env.TELEGRAM_TOPIC_INTAKE;
const channelId = env.TELEGRAM_CHANNEL_ID;

if (!token) {
  log("error", "missing-credential", ENV_FILE, "TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

async function api(method, params) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = await res.json().catch(() => null);
  if (!body) throw new Error(`${method} http ${res.status}`);
  if (!body.ok) throw new Error(`${method} ${body.error_code} ${body.description}`);
  return body.result;
}

function messagePayload(target, text) {
  const payload = {
    chat_id: String(target.chatId ?? chatId),
    text: toTelegramHtml(text),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };
  if (target.topic) payload.message_thread_id = Number(target.topic);
  if (target.replyTo) payload.reply_parameters = { message_id: Number(target.replyTo), allow_sending_without_reply: true };
  return payload;
}

async function sendText(target, text, attempts = 2) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const sent = await api("sendMessage", messagePayload(target, text));
      return sent;
    } catch (e) {
      lastError = e;
      if (String(e).includes("can't parse entities") || String(e).includes("can't find end of")) {
        try {
          const sent = await api("sendMessage", { ...messagePayload(target, text), parse_mode: undefined, text });
          return sent;
        } catch (e2) {
          lastError = e2;
        }
      }
      await sleep(500);
    }
  }
  log("error", "send", String(target.topic ?? "-"), String(lastError));
  return null;
}

if (mode === "notify") {
  const text = process.argv.slice(3).join(" ").trim();
  if (!text) {
    process.stderr.write("usage: tgd.mjs notify <text>\n");
    process.exit(2);
  }
  const target = channelId ? { chatId: channelId } : { chatId, topic: intakeTopic };
  let sent = 0;
  for (const chunk of chunkText(text)) {
    const result = await sendText(target, chunk);
    if (!result) break;
    sent += 1;
  }
  log("notify", `chunks=${sent}`, `target=${channelId ? `channel:${channelId}` : `chat:${chatId}`}`);
  process.stdout.write(`sent ${sent}\n`);
  process.exit(sent > 0 ? 0 : 1);
}

if (mode === "probe") {
  try {
    const updates = await api("getUpdates", { offset: -1, limit: 1, allowed_updates: ["message"] });
    const last = updates[0]?.message;
    const me = await api("getMe", {});
    process.stdout.write(
      `${JSON.stringify(
        {
          bot: { id: me.id, username: me.username },
          chatId: last?.chat?.id ?? null,
          chatType: last?.chat?.type ?? null,
          chatTitle: last?.chat?.title ?? null,
          userId: last?.from?.id ?? null,
          userName: last?.from?.username ?? null,
          threadId: last?.message_thread_id ?? null,
          text: last?.text ?? null,
        },
        null,
        2,
      )}\n`,
    );
  } catch (e) {
    process.stderr.write(`probe failed: ${e}\n`);
    process.exit(1);
  }
  process.exit(0);
}

if (!chatId || !allowedUser) {
  log("error", "missing-credential", ENV_FILE, !chatId ? "TELEGRAM_CHAT_ID" : "TELEGRAM_ALLOWED_USER");
  process.stderr.write("run: bun tgd.mjs probe  → send a message in the group first\n");
  process.exit(1);
}

const db = readJsonOr(STATE_FILE, { offset: null, alias: {}, convs: {}, alerts: {} });
db.alias = db.alias ?? {};
db.convs = db.convs ?? {};
db.channelPosts = db.channelPosts ?? {};
db.alerts = db.alerts ?? {};
for (const [key, entry] of Object.entries(db.convs)) {
  if (entry?.running) {
    log("warn", "orphan", key, entry.session ?? sessionName(key));
    entry.running = false;
  }
}
saveState();
pruneDir(LOG_DIR, LOG_RETENTION_MS);

const live = new Map();
const typing = { timer: null, cursor: 0, busy: false };
let active = 0;

function saveState() {
  writeJsonAtomic(STATE_FILE, db);
}

function convEntry(key) {
  db.convs[key] = db.convs[key] ?? {
    session: sessionName(key),
    running: false,
    lastMsgTs: new Date().toISOString(),
    rootText: null,
    topic: null,
    msgIds: [],
  };
  db.alias[key] = key;
  return db.convs[key];
}

function liveState(key) {
  if (!live.has(key)) live.set(key, { queue: [], child: null, timer: null, note: null });
  return live.get(key);
}

function remember(key, ids) {
  const entry = convEntry(key);
  for (const id of ids ?? []) {
    if (!id) continue;
    db.alias[String(id)] = key;
    if (!entry.msgIds.includes(id)) entry.msgIds.push(id);
  }
  if (entry.msgIds.length > 100) entry.msgIds = entry.msgIds.slice(-100);
  saveState();
}

function channelKey(postId) {
  return `ch${postId}`;
}

function resolveCommentKey(threadId, channelPosts) {
  if (!threadId) return null;
  for (const [postId, info] of Object.entries(channelPosts ?? {})) {
    if (String(info?.mirrorId) === String(threadId)) return channelKey(Number(postId));
  }
  return null;
}

function channelPostIdFor(message) {
  const source = message?.is_automatic_forward ? message : message?.reply_to_message;
  if (!source?.is_automatic_forward) return null;
  return source.forward_from_message_id ?? source.forward_origin?.message_id ?? null;
}

function rememberMirror(postId, mirrorId) {
  if (!postId || !mirrorId) return;
  db.channelPosts = db.channelPosts ?? {};
  db.channelPosts[String(postId)] = { mirrorId, at: new Date().toISOString() };
  db.alias[String(mirrorId)] = channelKey(postId);
  saveState();
  log("mirror", `post=${postId}`, `mirror=${mirrorId}`);
}

function convTopic(key, convs = db.convs, channelPosts = db.channelPosts) {
  const topic = convs?.[key]?.topic ?? null;
  if (topic) return topic;
  const match = /^ch(\d+)$/.exec(key);
  return match ? channelPosts?.[match[1]]?.mirrorId ?? null : null;
}

async function waitForMirror(postId, timeoutMs = 30_000, stepMs = 250) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const mirror = db.channelPosts?.[String(postId)]?.mirrorId;
    if (mirror) return mirror;
    if (Date.now() >= deadline) return null;
    await sleep(stepMs);
  }
}

function commentKeyFor(message) {
  const known = resolveCommentKey(message?.message_thread_id, db.channelPosts);
  if (known) return known;
  const postId = channelPostIdFor(message);
  if (!postId) return null;
  rememberMirror(postId, message.message_thread_id ?? message.reply_to_message?.message_id);
  return channelKey(postId);
}

function killGroup(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (e) {
    try {
      child.kill("SIGKILL");
    } catch (e2) {
      log("warn", "kill", String(e2));
    }
  }
}

async function reply(key, msg, text) {
  const topic = msg.channelPost ? null : convTopic(key);
  let replyTo = msg.msgId;
  if (msg.channelPost) {
    replyTo = await waitForMirror(msg.channelPost);
    if (!replyTo) log("warn", "no-mirror", `post=${msg.channelPost}`);
  }
  const target = { chatId, topic, replyTo };
  const ids = [];
  for (const chunk of chunkText(text)) {
    const sent = await sendText(target, chunk);
    if (!sent) break;
    ids.push(sent.message_id);
    target.replyTo = sent.message_id;
  }
  remember(key, ids);
}

function turnLimitMinutes(ms = TURN_TIMEOUT_MS) {
  return Math.max(1, Math.round(ms / 60_000));
}

function timeoutNote(ms = TURN_TIMEOUT_MS) {
  return `本轮超过 ${turnLimitMinutes(ms)} 分钟，已被终止`;
}

function pickTypingTarget(targets, cursor) {
  if (targets.length === 0) return null;
  return targets[cursor % targets.length];
}

function typingTargets() {
  const targets = [];
  for (const [key, state] of live) {
    if (!state.child) continue;
    const topic = convTopic(key);
    if (targets.some((t) => t.topic === topic)) continue;
    targets.push({ key, topic });
  }
  return targets;
}

async function typingTick() {
  if (typing.busy) return;
  const target = pickTypingTarget(typingTargets(), typing.cursor);
  if (!target) return;
  typing.busy = true;
  typing.cursor += 1;
  const payload = { chat_id: String(chatId), action: "typing" };
  if (target.topic) payload.message_thread_id = Number(target.topic);
  try {
    await api("sendChatAction", payload);
  } catch (e) {
    log("warn", "typing", target.key, String(e));
  } finally {
    typing.busy = false;
  }
}

function syncTyping() {
  if (typingTargets().length === 0) {
    if (typing.timer) clearInterval(typing.timer);
    typing.timer = null;
    return;
  }
  if (typing.timer) return;
  typing.cursor = 0;
  typingTick();
  typing.timer = setInterval(() => typingTick(), TYPING_REFRESH_MS);
}

async function start(key, msg) {
  const state = liveState(key);
  const entry = convEntry(key);
  const session = entry.session;
  const full = !hasSession(session);
  const prompt = full
    ? buildPrompt({
        raw: readFileSync(join(ROOT, "prompts/thread.md"), "utf8"),
        chatId,
        conversation: key,
        topic: entry.topic,
        userMessage: msg.text,
        rootText: entry.rootText,
        root: ROOT,
        statePath: STATE_PATH,
      })
    : msg.text;
  const workerLog = join(LOG_DIR, `worker-${key}-${msg.msgId}.log`);

  const child = spawn(PI, ["--print", "--session-id", session, "--", prompt], {
    cwd: HOME_CODE,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: `${join(HOME, ".volta/bin")}:${join(HOME, ".bun/bin")}:${process.env.PATH ?? ""}` },
  });

  active += 1;
  state.child = child;
  state.note = null;
  entry.running = true;
  saveState();
  syncTyping();
  log("dispatch", key, full ? "prompt=full" : "prompt=raw", msg.msgId);

  let stdout = "";
  let stderr = "";
  const appendWorkerLog = (chunk) => {
    try {
      appendFileSync(workerLog, chunk);
    } catch (e) {
      log("warn", "worker-log", String(e));
    }
  };
  try {
    writeFileSync(workerLog, `start=${new Date().toISOString()} msg=${msg.msgId} prompt=${full ? "full" : "raw"}\n`);
  } catch (e) {
    log("warn", "worker-log", String(e));
  }
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    appendWorkerLog(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    appendWorkerLog(chunk);
  });
  state.timer = setTimeout(() => {
    state.note = timeoutNote();
    killGroup(child);
  }, TURN_TIMEOUT_MS);

  let finished = false;
  const finish = async (code, spawnError) => {
    if (finished) return;
    finished = true;
    clearTimeout(state.timer);
    state.timer = null;
    state.child = null;
    active -= 1;
    entry.running = false;
    saveState();
    syncTyping();
    try {
      appendFileSync(workerLog, `\n--- exit=${code} ---\n`);
    } catch (e) {
      log("warn", "worker-log", String(e));
    }
    log("done", key, `exit=${code}`, workerLog);
    const text = stdout.trim();
    if (spawnError) await reply(key, msg, `worker 起不来：${spawnError}`);
    else if (state.note) await reply(key, msg, state.note);
    else if (!text) await reply(key, msg, `[无输出] exit=${code}\n${stderr.trim().split("\n").slice(-20).join("\n")}`.trim());
    else await reply(key, msg, text);
    state.note = null;
    pump();
  };
  child.on("close", (code) => finish(code, null));
  child.on("error", (e) => {
    log("error", "spawn", key, String(e));
    finish(null, String(e));
  });
}

function pump() {
  for (const [key, state] of live) {
    if (active >= MAX_WORKERS) return;
    if (state.child || state.queue.length === 0) continue;
    const msg = state.queue.shift();
    start(key, msg).catch((e) => log("error", "dispatch", key, String(e)));
  }
}

async function enqueue(key, msg) {
  const state = liveState(key);
  const entry = convEntry(key);
  entry.lastMsgTs = new Date().toISOString();
  if (msg.topic !== null && msg.topic !== undefined) entry.topic = msg.topic;
  if (entry.rootText === null || entry.rootText === undefined) entry.rootText = msg.rootText ?? msg.text;
  remember(key, [msg.msgId]);
  if (state.queue.length >= QUEUE_DEPTH) {
    log("warn", "queue-full", key);
    await reply(key, msg, `排队已满（${QUEUE_DEPTH} 条），稍后重试`);
    return;
  }
  state.queue.push({ ...msg, enqueuedAt: Date.now() });
  pump();
}

async function cancel(key) {
  const state = liveState(key);
  const dropped = state.queue.length;
  state.queue.length = 0;
  if (state.child) {
    state.note = `已按指令终止本轮${dropped ? `，清掉 ${dropped} 条排队` : ""}`;
    killGroup(state.child);
  } else {
    await reply(key, { msgId: null }, "当前没有在跑的任务");
  }
  log("cancel", key, `dropped=${dropped}`);
}

function isBusy(key) {
  const state = liveState(key);
  return Boolean(state.child) || state.queue.length > 0;
}

async function handleMessage(message) {
  if (message.is_automatic_forward) {
    const postId = channelPostIdFor(message);
    if (postId) rememberMirror(postId, message.message_id);
    else log("ignore", "auto-forward", message.message_id);
    return;
  }
  if (String(message.chat?.id) !== String(chatId)) return log("ignore", "chat", message.chat?.id);
  if (message.from?.is_bot) return log("ignore", "bot", message.from?.id);
  if (String(message.from?.id) !== String(allowedUser)) return log("ignore", "author", message.from?.id);
  const text = (message.text ?? "").trim();
  if (!text) return log("ignore", "empty", message.message_id);

  const commentKey = commentKeyFor(message);
  if (!commentKey) return log("ignore", "not-comment", message.message_id);
  if (isStop(text) && isBusy(commentKey)) return cancel(commentKey);
  await enqueue(commentKey, {
    msgId: message.message_id,
    text,
    topic: message.message_thread_id ?? null,
    threadId: message.message_thread_id,
    rootText: null,
  });
}

async function handleChannelPost(post) {
  if (!channelId) return log("ignore", "channel-post-noid", post.message_id);
  if (String(post.chat?.id) !== String(channelId)) return log("ignore", "channel", post.chat?.id);
  const text = (post.text ?? "").trim();
  if (!text) return log("ignore", "channel-empty", post.message_id);
  const key = channelKey(post.message_id);
  if (isStop(text) && isBusy(key)) return cancel(key);
  await enqueue(key, {
    msgId: post.message_id,
    channelPost: post.message_id,
    text,
    topic: null,
    rootText: text,
  });
}

setInterval(() => {
  for (const [key, state] of live) {
    const expired = state.queue.filter((m) => Date.now() - m.enqueuedAt > WAIT_TIMEOUT_MS);
    if (expired.length === 0) continue;
    state.queue = state.queue.filter((m) => Date.now() - m.enqueuedAt <= WAIT_TIMEOUT_MS);
    log("warn", "wait-timeout", key, `expired=${expired.length}`);
    reply(key, { msgId: null }, "当前繁忙，本轮未处理，稍后重发").catch((e) => log("error", "wait-timeout-reply", String(e)));
  }
}, 60_000).unref();

setInterval(() => {
  pruneDir(LOG_DIR, LOG_RETENTION_MS);
  const pruned = pruneConversations(db.convs, db.alias);
  const dropped = Object.keys(db.convs).length - Object.keys(pruned.convs).length;
  if (dropped > 0) {
    db.convs = pruned.convs;
    db.alias = pruned.alias;
    saveState();
    log("info", "convs-pruned", `dropped=${dropped}`);
  }
  const keptPosts = {};
  for (const [postId, info] of Object.entries(db.channelPosts ?? {})) {
    const seen = Date.parse(info?.at ?? "");
    if (Number.isFinite(seen) && Date.now() - seen > CONV_RETENTION_MS) continue;
    keptPosts[postId] = info;
  }
  if (Object.keys(keptPosts).length !== Object.keys(db.channelPosts ?? {}).length) {
    db.channelPosts = keptPosts;
    saveState();
    log("info", "channel-posts-pruned");
  }
}, PRUNE_INTERVAL_MS).unref();

async function alertOnce(kind, text) {
  const now = Date.now();
  if (!alertAllowed(db.alerts, kind, now)) return log("info", "alert-suppressed", kind);
  db.alerts[kind] = new Date(now).toISOString();
  saveState();
  log("warn", "alert", kind);
  await sendText({ chatId, topic: intakeTopic }, text);
}

log("info", "start", `chat=${chatId}`, `user=${allowedUser}`, `state=${STATE_FILE}`, `root=${ROOT}`);

async function bootstrapOffset() {
  if (db.offset !== null && db.offset !== undefined) return;
  try {
    const updates = await api("getUpdates", { offset: -1, limit: 1, allowed_updates: ["message"] });
    const last = updates[0];
    db.offset = last ? last.update_id + 1 : 0;
    saveState();
    log("info", "bootstrap", `offset=${db.offset}`);
  } catch (e) {
    log("error", "bootstrap", String(e));
  }
}

async function poll() {
  let backoff = 1_000;
  let failures = 0;
  for (;;) {
    try {
      const updates = await api("getUpdates", {
        offset: db.offset ?? 0,
        timeout: POLL_TIMEOUT_S,
        limit: 50,
        allowed_updates: ["message", "channel_post"],
      });
      backoff = 1_000;
      failures = 0;
      if (RAW_LOG) {
        const file = join(LOG_DIR, `raw-${new Date().toISOString().slice(0, 10)}.jsonl`);
        for (const update of updates) {
          try {
            appendFileSync(file, `${JSON.stringify(update)}\n`);
          } catch (e) {
            log("warn", "raw-log", String(e));
          }
        }
      }
      for (const update of updates) {
        db.offset = update.update_id + 1;
        saveState();
        if (update.channel_post) {
          await handleChannelPost(update.channel_post).catch((e) => log("error", "channel-post", String(e)));
          continue;
        }
        if (update.message) await handleMessage(update.message).catch((e) => log("error", "handle", String(e)));
      }
    } catch (e) {
      failures += 1;
      log("error", "poll", String(e));
      if (failures >= 3) await alertOnce("poll", `tgd 拉消息连续失败：${e}`).catch(() => {});
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}

await bootstrapOffset();
await poll();
