#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME;
const ENV_FILE = join(HOME, ".config/taskradar/feishu.env");
const BASE = "https://open.feishu.cn/open-apis";
const MESSAGE_LIMIT = 4000;

function readEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
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

async function api(path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`${path} http ${res.status}`);
  if (json.code !== 0) throw new Error(`${path} ${json.code} ${json.msg}`);
  return json;
}

const env = { ...readEnv(ENV_FILE), ...process.env };
const chatId = process.env.FEISHU_CHAT_ID ?? env.FEISHU_CHAT_ID;
const text = process.argv.slice(2).join(" ").trim();

if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
  process.stderr.write(`missing FEISHU_APP_ID / FEISHU_APP_SECRET in ${ENV_FILE}\n`);
  process.exit(2);
}
if (!chatId) {
  process.stderr.write(`missing FEISHU_CHAT_ID in ${ENV_FILE}\n`);
  process.exit(2);
}
if (!text) {
  process.stderr.write("usage: notify.mjs <text>\n");
  process.exit(2);
}

const auth = await api("/auth/v3/tenant_access_token/internal", { app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET });
const token = auth.tenant_access_token;

let sent = 0;
for (const chunk of chunkText(text)) {
  try {
    await api("/im/v1/messages?receive_id_type=chat_id", {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text: chunk }),
    }, token);
    sent += 1;
  } catch (e) {
    process.stderr.write(`${e}\n`);
    break;
  }
}

process.stdout.write(`sent ${sent}\n`);
process.exit(sent > 0 ? 0 : 1);
