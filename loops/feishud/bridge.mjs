#!/usr/bin/env bun
import * as lark from "@larksuiteoapi/node-sdk";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME;
const CFG_DIR = join(HOME, ".config/taskradar");
const LOG_DIR = join(CFG_DIR, "logs/tgd");
const ENV_FILE = join(CFG_DIR, "feishu.env");
const STATE_FILE = join(CFG_DIR, "feishud.json");
const HOME_CODE = join(HOME, "code");
const PI = join(HOME, ".bun/bin/pi");
const PROJECT_DIR = join(HOME, ".pi/agent/sessions", `--${HOME_CODE.replace(/^\//, "").replace(/[\/\\:]/g, "-")}--`);
const ALLOWED_OPEN_ID = process.env.TGD_ALLOWED_OPEN_ID ?? "ou_ce8b91019c8e721b5b47ff89b4a78fba";
const WORKER = process.env.TGD_WORKER ?? "stub";
const MESSAGE_LIMIT = 4000;
const CARD_LIMIT = 3000;

mkdirSync(LOG_DIR, { recursive: true });

function readEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function log(level, ...parts) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg: parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ") });
  process.stderr.write(`${line}\n`);
  try {
    appendFileSync(join(LOG_DIR, `feishu-${new Date().toISOString().slice(0, 10)}.jsonl`), `${line}\n`);
  } catch (e) {}
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch (e) {
    return { convs: {}, seen: {} };
  }
}

function saveState(state) {
  writeFileSync(`${STATE_FILE}.tmp-${process.pid}`, `${JSON.stringify(state, null, 2)}\n`);
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function chunkText(text, limit = MESSAGE_LIMIT) {
  const chunks = [];
  let buf = "";
  for (const line of text.split("\n")) {
    if (buf && buf.length + line.length + 1 > limit) {
      chunks.push(buf);
      buf = "";
    }
    buf = buf ? `${buf}\n${line}` : line;
    while (buf.length > limit) {
      chunks.push(buf.slice(0, limit));
      buf = buf.slice(limit);
    }
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [""];
}

function buildPrompt({ conversation, chatId, userMessage, rootText }) {
  const raw = readFileSync(join(ROOT, "prompts/thread.md"), "utf8");
  return raw
    .replaceAll("{{conversation}}", String(conversation))
    .replaceAll("{{chat_id}}", String(chatId))
    .replaceAll("{{user_message}}", userMessage)
    .replaceAll("{{root_text}}", rootText ?? userMessage);
}

function hasSession(session) {
  try {
    return readdirSync(PROJECT_DIR).some((f) => f.endsWith(`_${session}.jsonl`));
  } catch (e) {
    return false;
  }
}

const env = { ...readEnv(ENV_FILE), ...process.env };
if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
  log("error", "missing-credential", ENV_FILE);
  process.exit(1);
}

const client = new lark.Client({ appId: env.FEISHU_APP_ID, appSecret: env.FEISHU_APP_SECRET, domain: lark.Domain.Feishu, loggerLevel: lark.LoggerLevel.warn });

function textOf(message) {
  try {
    return JSON.parse(message.content ?? "{}").text ?? "";
  } catch (e) {
    return message.content ?? "";
  }
}

function conversationKey(message) {
  if (message.thread_id) return `th-${message.thread_id}`;
  if (message.root_id) return `th-${message.root_id}`;
  if (message.parent_id) return `th-${message.parent_id}`;
  return `ms-${message.message_id}`;
}

function toCard(text) {
  return {
    schema: "2.0",
    body: {
      elements: chunkText(text, CARD_LIMIT).map((content) => ({ tag: "markdown", content })),
    },
  };
}

async function sendReply(message, msgType, content) {
  return client.im.v1.message.reply({
    path: { message_id: message.message_id },
    data: {
      msg_type: msgType,
      content: JSON.stringify(content),
      ...(message.thread_id ? { reply_in_thread: true } : {}),
    },
  });
}

async function replyInPlace(message, text) {
  const ids = [];
  for (const chunk of chunkText(text)) {
    let res = await sendReply(message, "interactive", toCard(chunk));
    if (res.code !== 0) {
      log("warn", "card-fallback", res.code, res.msg);
      res = await sendReply(message, "text", { text: chunk });
    }
    if (res.code !== 0) {
      log("error", "reply", res.code, res.msg);
      break;
    }
    ids.push(res.data?.message_id);
  }
  return ids;
}

const state = readState();
const active = new Set();

async function runSession(key, message, text) {
  const entry = state.convs[key] ?? { session: `fs-${key}`, lastMsgTs: null, rootText: null };
  state.convs[key] = entry;
  entry.lastMsgTs = new Date().toISOString();
  if (!entry.rootText) entry.rootText = text;
  saveState(state);

  const session = entry.session;
  const full = !hasSession(session);
  active.add(key);

  const prompt = full ? buildPrompt({ conversation: key, chatId: message.chat_id, userMessage: text, rootText: entry.rootText }) : text;

  const args = WORKER === "stub" ? ["-e", `console.log("[stub] session=${session} full=${full}\\n收到: ${text}")`] : ["--print", "--session-id", session, "--", prompt];
  const bin = WORKER === "stub" ? process.execPath : PI;

  log("dispatch", key, `session=${session}`, full ? "prompt=full" : "prompt=raw");
  let stdout = "";
  let stderr = "";
  const child = spawn(bin, args, { cwd: HOME_CODE, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PATH: `${join(HOME, ".volta/bin")}:${join(HOME, ".bun/bin")}:${process.env.PATH ?? ""}` } });
  child.stdout.on("data", (c) => (stdout += c));
  child.stderr.on("data", (c) => (stderr += c));
  child.on("close", async (code) => {
    active.delete(key);
    const out = stdout.trim();
    log("done", key, `exit=${code}`);
    await replyInPlace(message, out || `[无输出] exit=${code}\n${stderr.trim().split("\n").slice(-10).join("\n")}`);
  });
}

const dispatcher = new lark.EventDispatcher({}).register({
  "im.message.receive_v1": async (data) => {
    const m = data.message ?? {};
    const senderType = data.sender?.sender_type ?? "";
    const openId = data.sender?.sender_id?.open_id ?? "";
    const text = textOf(m).trim();

    const dedupe = state.seen[m.message_id];
    if (dedupe) return { code: 0 };

    if (senderType === "app") {
      return { code: 0 };
    }
    if (ALLOWED_OPEN_ID && openId !== ALLOWED_OPEN_ID) {
      log("ignore", "author", openId);
      return { code: 0 };
    }
    if (!text) {
      log("ignore", "empty", m.message_id);
      return { code: 0 };
    }

    state.seen[m.message_id] = new Date().toISOString();
    saveState(state);

    const key = conversationKey(m);
    log("message", key, JSON.stringify({ parent: m.parent_id ?? null, thread: m.thread_id ?? null, root: m.root_id ?? null, chat: m.chat_id }));
    runSession(key, m, text).catch((e) => log("error", "run", String(e)));
    return { code: 0 };
  },
});

const ws = new lark.WSClient({
  appId: env.FEISHU_APP_ID,
  appSecret: env.FEISHU_APP_SECRET,
  domain: lark.Domain.Feishu,
  loggerLevel: lark.LoggerLevel.warn,
  autoReconnect: true,
  onReady: () => log("info", "ws-ready"),
  onError: (e) => log("error", "ws", String(e?.message ?? e)),
});

log("info", "start", `worker=${WORKER}`, `allowed=${ALLOWED_OPEN_ID || "any"}`);
ws.start({ eventDispatcher: dispatcher });
