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
const LOG_DIR = join(CFG_DIR, "logs/slackd");
const INTAKE_LOG_DIR = join(CFG_DIR, "logs/intake");
const SLACKD_FILE = join(CFG_DIR, "slackd.json");
const HOME_CODE = join(HOME, "code");
const PI = join(HOME, ".bun/bin/pi");
const PROJECT_DIR = join(HOME, ".pi/agent/sessions", `--${HOME_CODE.replace(/^\//, "").replace(/[\/\\:]/g, "-")}--`);

const CHANNEL = process.env.SLACKD_CHANNEL ?? "C0C9N6SSH39";
const ALLOWED_USER = process.env.SLACKD_ALLOWED_USER ?? "U0A5T8AR9EU";
const BOT_USER = process.env.SLACKD_BOT_USER ?? "U0CA3CY2JKU";
const STATE_PATH = process.env.TASKRADAR_STATE ?? join(CFG_DIR, "state.json");
const MAX_WORKERS = Number(process.env.SLACKD_MAX_WORKERS ?? 2);
const QUEUE_DEPTH = Number(process.env.SLACKD_QUEUE_DEPTH ?? 3);
const TURN_TIMEOUT_MS = Number(process.env.SLACKD_TIMEOUT_MS ?? 20 * 60_000);
const WAIT_TIMEOUT_MS = Number(process.env.SLACKD_WAIT_MS ?? 20 * 60_000);
const LOG_RETENTION_MS = 72 * 3_600_000;
const THREAD_RETENTION_MS = 30 * 86_400_000;
const REPLY_LIMIT = 3500;
const PRUNE_INTERVAL_MS = 86_400_000;
const PASSING_SUBTYPES = ["thread_broadcast", "file_share"];
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
        process.stderr.write(`slackd: cannot quarantine ${file}: ${e2}\n`);
      }
    }
    return fallback;
  }
}

function logFile() {
  return join(LOG_DIR, `slackd-${new Date().toISOString().slice(0, 10)}.jsonl`);
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
    process.stderr.write(`slackd: log write failed: ${e}\n`);
  }
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

function stripMentions(text) {
  return (text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim();
}

function isStop(text) {
  return STOP_WORDS.includes(text.trim().toLowerCase());
}

function sessionName(thread) {
  return `slack-${thread.replace(".", "")}`;
}

function hasSession(session) {
  try {
    return readdirSync(PROJECT_DIR).some((f) => f.endsWith(`_${session}.jsonl`));
  } catch (e) {
    log("warn", "hasSession", String(e));
    return false;
  }
}

function truncate(text, workerLog) {
  if (text.length <= REPLY_LIMIT) return text;
  const suffix = `\n…已截断，完整内容见 ${workerLog}`;
  return text.slice(0, REPLY_LIMIT - suffix.length) + suffix;
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

function readCookies() {
  const lines = readFileSync(join(CFG_DIR, ".slack-xoxc.tmp"), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error(".slack-xoxc.tmp needs two lines");
  return { xoxc: lines[0], xoxd: lines[1] };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runSelftest() {
  const { strictEqual, deepStrictEqual, ok } = assert;
  strictEqual(stripMentions("<@U0A5T8AR9EU> 帮我扫一下"), "帮我扫一下");
  strictEqual(stripMentions("<@U0CA3CY2JKU>"), "");
  strictEqual(stripMentions(undefined), "");
  ok(isStop(" 停 "));
  ok(isStop("STOP"));
  ok(!isStop("停下来"));
  ok(!isStop("stop please"));
  strictEqual(sessionName("1792416209.221679"), "slack-1792416209221679");
  ok(sessionName("1792416209.221679").match(/^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/));
  strictEqual(PROJECT_DIR, join(HOME, ".pi/agent/sessions", "--home-manooog-code--"));

  const subtypeAllowed = (s) => !s || PASSING_SUBTYPES.includes(s);
  ok(subtypeAllowed(undefined));
  ok(subtypeAllowed("thread_broadcast"));
  ok(subtypeAllowed("file_share"));
  ok(!subtypeAllowed("message_changed"));
  ok(!subtypeAllowed("channel_join"));

  const reply = truncate("x".repeat(4000), "/tmp/worker.log");
  ok(reply.length <= REPLY_LIMIT, `truncate length ${reply.length}`);
  ok(reply.endsWith("完整内容见 /tmp/worker.log"));

  const ring = [];
  const push = (ts) => {
    ring.push(ts);
    if (ring.length > 200) ring.splice(0, ring.length - 200);
  };
  for (let i = 0; i < 205; i += 1) push(`ts-${i}`);
  strictEqual(ring.length, 200);
  ok(ring.includes("ts-204"));
  ok(!ring.includes("ts-4"));

  const dir = join(tmpdir(), `slackd-selftest-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "old.jsonl"), "");
  writeFileSync(join(dir, "fresh.jsonl"), "");
  const old = new Date(Date.now() - 4 * 86_400_000);
  utimesSync(join(dir, "old.jsonl"), old, old);
  strictEqual(pruneDir(dir, LOG_RETENTION_MS), 1);
  deepStrictEqual(readdirSync(dir), ["fresh.jsonl"]);
  rmSync(dir, { recursive: true, force: true });

  const threads = { a: { lastMsgTs: new Date(Date.now() - 40 * 86_400_000).toISOString() }, b: { lastMsgTs: new Date().toISOString() } };
  const kept = pruneThreads(threads);
  deepStrictEqual(Object.keys(kept), ["b"]);

  const prompt = buildPrompt({
    raw: readFileSync(join(ROOT, "prompts/thread.md"), "utf8"),
    channel: CHANNEL,
    thread: "1792416209.221679",
    userMessage: "扫一下 backend",
    rootText: "[20261020-0819-1] 候选 id",
    root: ROOT,
    statePath: STATE_PATH,
  });
  ok(!prompt.includes("{{"), "prompt placeholders all replaced");
  ok(prompt.includes("扫一下 backend"));
  ok(prompt.includes("[20261020-0819-1] 候选 id"));
  ok(prompt.includes("本 thread 的回帖只能靠 stdout"));
  ok(prompt.includes("不要用 bg_run 起长期进程"));

  process.stdout.write("selftest ok\n");
}

function pruneThreads(threads) {
  const out = {};
  for (const [key, value] of Object.entries(threads ?? {})) {
    const seen = Date.parse(value?.lastMsgTs ?? "");
    if (Number.isFinite(seen) && Date.now() - seen > THREAD_RETENTION_MS) continue;
    out[key] = value;
  }
  return out;
}

function buildPrompt({ raw, channel, thread, userMessage, rootText, root, statePath }) {
  return raw
    .replaceAll("{{channel}}", channel)
    .replaceAll("{{thread_ts}}", thread)
    .replaceAll("{{user_message}}", userMessage)
    .replaceAll("{{root_text}}", rootText ?? "")
    .replaceAll("{{root}}", root)
    .replaceAll("{{state_path}}", statePath);
}

if (process.argv.includes("--selftest")) {
  runSelftest();
  process.exit(0);
}

mkdirSync(LOG_DIR, { recursive: true });
mkdirSync(INTAKE_LOG_DIR, { recursive: true });

const credentials = readEnvFile(join(CFG_DIR, "slack-app.env"));
const appToken = credentials.SLACK_APP_TOKEN;
if (!appToken) {
  log("error", "missing-credential", join(CFG_DIR, "slack-app.env"), "SLACK_APP_TOKEN");
  await sleep(300_000);
  process.exit(1);
}

let cookies = null;
try {
  cookies = readCookies();
} catch (e) {
  log("error", "missing-credential", join(CFG_DIR, ".slack-xoxc.tmp"), String(e));
}

let webhookUrl = null;
try {
  webhookUrl = readFileSync(join(CFG_DIR, "webhook.url"), "utf8").trim();
} catch (e) {
  log("error", "missing-credential", join(CFG_DIR, "webhook.url"), String(e));
}

log("info", "start", `channel=${CHANNEL}`, `state=${STATE_PATH}`, `root=${ROOT}`);

const db = readJsonOr(SLACKD_FILE, { dedup: [], threads: {} });
db.dedup = Array.isArray(db.dedup) ? db.dedup.slice(-200) : [];
db.threads = db.threads ?? {};
for (const [thread, entry] of Object.entries(db.threads)) {
  if (entry?.running) {
    log("warn", "orphan", thread, entry.session ?? sessionName(thread));
    entry.running = false;
  }
  if (Array.isArray(entry?.queue)) entry.queue = [];
}
saveSlackd();
pruneDir(LOG_DIR, LOG_RETENTION_MS);
pruneDir(INTAKE_LOG_DIR, LOG_RETENTION_MS);

const live = new Map();
let active = 0;

function saveSlackd() {
  writeJsonAtomic(SLACKD_FILE, db);
}

function threadEntry(thread) {
  db.threads[thread] = db.threads[thread] ?? { session: sessionName(thread), running: false, lastMsgTs: new Date().toISOString(), rootText: null, rootFail: 0 };
  return db.threads[thread];
}

function liveState(thread) {
  if (!live.has(thread)) live.set(thread, { queue: [], child: null, timer: null, note: null });
  return live.get(thread);
}

function seen(ts) {
  if (db.dedup.includes(ts)) return true;
  db.dedup.push(ts);
  if (db.dedup.length > 200) db.dedup.splice(0, db.dedup.length - 200);
  saveSlackd();
  return false;
}

async function post(thread, text) {
  if (!webhookUrl) return log("error", "post", "webhook.url missing");
  const body = JSON.stringify(thread ? { text, thread_ts: thread } : { text });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      const detail = (await res.text()).slice(0, 200);
      if (res.ok) return log("post", thread ?? "-", `${text.length} chars`);
      log("error", "post", res.status, detail);
    } catch (e) {
      log("error", "post", String(e));
    }
  }
}

async function fetchRoot(thread) {
  if (!cookies) throw new Error("no cookies");
  const url = new URL("https://slack.com/api/conversations.replies");
  url.searchParams.set("channel", CHANNEL);
  url.searchParams.set("ts", thread);
  url.searchParams.set("limit", "1");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${cookies.xoxc}`, Cookie: `d=${cookies.xoxd}` } });
  const body = await res.json();
  if (!body.ok) throw new Error(`replies ${body.error}`);
  return body.messages?.[0]?.text ?? "";
}

async function rootTextFor(thread) {
  const entry = threadEntry(thread);
  if (entry.rootText !== null && entry.rootText !== undefined) return entry.rootText;
  try {
    entry.rootText = await fetchRoot(thread);
    entry.rootFail = 0;
    log("info", "root", thread, `${entry.rootText.length} chars`);
  } catch (e) {
    entry.rootFail = (entry.rootFail ?? 0) + 1;
    log("error", "root-fetch", thread, String(e));
    if (entry.rootFail >= 3) {
      entry.rootText = "";
      log("warn", "root-giveup", thread);
    }
  }
  saveSlackd();
  return entry.rootText ?? null;
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

async function start(thread, msg) {
  const state = liveState(thread);
  const entry = threadEntry(thread);
  const session = sessionName(thread);
  const root = entry.rootText ?? null;
  const full = !hasSession(session) || root === null;
  const prompt = full
    ? buildPrompt({
        raw: readFileSync(join(ROOT, "prompts/thread.md"), "utf8"),
        channel: CHANNEL,
        thread,
        userMessage: msg.text,
        rootText: root,
        root: ROOT,
        statePath: STATE_PATH,
      })
    : msg.text;
  const workerLog = join(LOG_DIR, `worker-${msg.ts.replace(".", "")}.log`);

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
  saveSlackd();
  log("dispatch", thread, full ? "prompt=full" : "prompt=raw", msg.ts);

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  state.timer = setTimeout(() => {
    state.note = "本轮超过 20 分钟，已被终止";
    killGroup(child);
  }, TURN_TIMEOUT_MS);

  let finished = false;
  const finish = (code, spawnError) => {
    if (finished) return;
    finished = true;
    clearTimeout(state.timer);
    state.timer = null;
    state.child = null;
    active -= 1;
    entry.running = false;
    saveSlackd();
    try {
      writeFileSync(workerLog, `exit=${code}\n\n--- stderr ---\n${stderr}\n--- stdout ---\n${stdout}\n`);
    } catch (e) {
      log("warn", "worker-log", String(e));
    }
    log("done", thread, `exit=${code}`, workerLog);
    const text = stdout.trim();
    if (spawnError) post(thread, `worker 起不来：${spawnError}`);
    else if (state.note) post(thread, state.note);
    else if (!text) post(thread, `[无输出] exit=${code}\n${stderr.trim().split("\n").slice(-20).join("\n")}`.trim());
    else post(thread, truncate(text, workerLog));
    state.note = null;
    pump();
  };
  child.on("close", (code) => finish(code, null));
  child.on("error", (e) => {
    log("error", "spawn", thread, String(e));
    finish(null, String(e));
  });
}

function pump() {
  for (const [thread, state] of live) {
    if (active >= MAX_WORKERS) return;
    if (state.child || state.queue.length === 0) continue;
    const msg = state.queue.shift();
    start(thread, msg).catch((e) => log("error", "dispatch", thread, String(e)));
  }
}

function enqueue(thread, msg) {
  const state = liveState(thread);
  const entry = threadEntry(thread);
  entry.lastMsgTs = new Date().toISOString();
  saveSlackd();
  if (state.queue.length >= QUEUE_DEPTH) {
    log("warn", "queue-full", thread);
    post(thread, `排队已满（${QUEUE_DEPTH} 条），稍后重试`);
    return;
  }
  state.queue.push({ ...msg, enqueuedAt: Date.now() });
  pump();
}

function cancel(thread) {
  const state = liveState(thread);
  const dropped = state.queue.length;
  state.queue.length = 0;
  if (state.child) {
    state.note = `已按指令终止本轮${dropped ? `，清掉 ${dropped} 条排队` : ""}`;
    killGroup(state.child);
  } else {
    post(thread, "当前没有在跑的任务");
  }
  log("cancel", thread, `dropped=${dropped}`);
}

setInterval(() => {
  for (const [thread, state] of live) {
    const expired = state.queue.filter((m) => Date.now() - m.enqueuedAt > WAIT_TIMEOUT_MS);
    if (expired.length === 0) continue;
    state.queue = state.queue.filter((m) => Date.now() - m.enqueuedAt <= WAIT_TIMEOUT_MS);
    log("warn", "wait-timeout", thread, `expired=${expired.length}`);
    post(thread, "当前繁忙，本轮未处理，稍后重发");
  }
}, 60_000).unref();

setInterval(() => {
  pruneDir(LOG_DIR, LOG_RETENTION_MS);
  pruneDir(INTAKE_LOG_DIR, LOG_RETENTION_MS);
  const kept = pruneThreads(db.threads);
  const dropped = Object.keys(db.threads).length - Object.keys(kept).length;
  if (dropped > 0) {
    db.threads = kept;
    saveSlackd();
    log("info", "threads-pruned", `dropped=${dropped}`);
  }
}, PRUNE_INTERVAL_MS).unref();

function handle(event) {
  if (!event || event.type !== "message") return log("ignore", "event-type", event?.type ?? "none");
  if (event.channel !== CHANNEL) return log("ignore", "channel", event.channel);
  if (event.bot_id || event.user === BOT_USER) return log("ignore", "self", event.bot_id ?? event.user);
  if (event.subtype && !PASSING_SUBTYPES.includes(event.subtype)) return log("ignore", "subtype", event.subtype);
  if (event.user !== ALLOWED_USER) return log("ignore", "author", event.user ?? "");
  const text = stripMentions(event.text);
  if (!text) return log("ignore", "empty", event.ts);
  if (seen(event.ts)) return log("dedupe", event.ts);
  const thread = event.thread_ts ?? event.ts;
  const state = liveState(thread);
  if (isStop(text) && (state.child || state.queue.length > 0)) return cancel(thread);
  enqueue(thread, { ts: event.ts, text });
}

function listen(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let lastPong = Date.now();
    let pingId = 0;
    const heartbeat = setInterval(() => {
      if (Date.now() - lastPong > 90_000) {
        log("warn", "pong-timeout");
        try {
          ws.close();
        } catch (e) {
          log("warn", "close", String(e));
        }
        return;
      }
      try {
        ws.send(JSON.stringify({ type: "ping", id: `p${(pingId += 1)}` }));
      } catch (e) {
        log("warn", "ping", String(e));
      }
    }, 30_000);

    ws.addEventListener("message", (frame) => {
      let envelope;
      try {
        envelope = JSON.parse(frame.data);
      } catch (e) {
        return log("warn", "frame", String(e));
      }
      if (envelope.envelope_id) ws.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
      if (envelope.type === "pong") {
        lastPong = Date.now();
        return;
      }
      if (envelope.type === "hello") return log("info", "hello");
      if (envelope.type === "disconnect") {
        log("warn", "disconnect", envelope.reason ?? "");
        try {
          ws.close();
        } catch (e) {
          log("warn", "close", String(e));
        }
        return;
      }
      if (envelope.type !== "events_api") return log("ignore", "envelope", envelope.type ?? "");
      handle(envelope.payload?.event);
    });
    ws.addEventListener("error", (event) => log("warn", "ws-error", String(event?.message ?? event)));
    ws.addEventListener("close", () => {
      clearInterval(heartbeat);
      resolve();
    });
  });
}

async function openSocket() {
  const res = await fetch("https://slack.com/api/apps.connections.open", {
    method: "POST",
    headers: { Authorization: `Bearer ${appToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "",
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`connections.open ${body.error}`);
  return body.url;
}

let authAlerts = 0;
let lastAuthAlert = 0;

async function serve() {
  let backoff = 1_000;
  for (;;) {
    let url;
    try {
      url = await openSocket();
    } catch (e) {
      log("error", "connections.open", String(e));
      const authFailure = String(e).includes("invalid_auth") || String(e).includes("not_authed");
      authAlerts = authFailure ? authAlerts + 1 : 0;
      if (authFailure && authAlerts >= 3 && Date.now() - lastAuthAlert > 30 * 60_000) {
        lastAuthAlert = Date.now();
        post(null, `slackd 收不到事件：app token 鉴权失败（${e}）。检查 ${join(CFG_DIR, "slack-app.env")}`);
      }
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
      continue;
    }
    backoff = 1_000;
    authAlerts = 0;
    await listen(url);
    log("warn", "socket closed, reconnecting");
    await sleep(1_000);
  }
}

serve();
