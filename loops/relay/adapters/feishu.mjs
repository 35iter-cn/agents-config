#!/usr/bin/env bun
import { join } from "node:path";
import { chunkText } from "../chunk.mjs";

const CARD_LIMIT = 3000;
const DEFAULT_ALLOWED = "ou_ce8b91019c8e721b5b47ff89b4a78fba";
const PROGRESS_EMOJI = "THINKING";
const PERMISSION_ERRORS = new Set([99991672, 99991663, 99991400, 1061045]);

export const replyRules = "- stdout 会以 `interactive` 卡片（schema 2.0 + markdown 元素）发回本话题，超过 3000 字符切成多条卡片。\n- 用 **粗体**、`行内代码`、``` 代码围栏、• 列表；不要用 `#` 标题，不要用 Markdown 表格。\n- 超过约 3000 字不要硬塞，写到 `~/.config/taskradar/logs/feishu/` 下的文件，回帖只给路径与摘要。";

export function conversationKey(message) {
  if (message?.thread_id) return `th-${message.thread_id}`;
  if (message?.root_id) return `th-${message.root_id}`;
  if (message?.parent_id) return `th-${message.parent_id}`;
  return `ms-${message?.message_id}`;
}

export function sessionFor(key) {
  return `fs-${key}`;
}

export function textOf(message) {
  try {
    return JSON.parse(message?.content ?? "{}").text ?? "";
  } catch {
    return message?.content ?? "";
  }
}

export function stripMentions(text, mentions = []) {
  let out = String(text ?? "");
  for (const mention of mentions) {
    if (!mention?.key) continue;
    out = out.split(`${mention.key} `).join("").split(mention.key).join("");
  }
  return out.trim();
}

export function isAcceptedSender(sender, allowedUser) {
  const type = sender?.sender_type ?? "";
  if (type === "app") return { ok: false, why: "bot" };
  const openId = sender?.sender_id?.open_id ?? "";
  if (allowedUser && openId !== allowedUser) return { ok: false, why: "author" };
  return { ok: true, openId };
}

export function toCard(text, limit = CARD_LIMIT) {
  return {
    schema: "2.0",
    body: { elements: chunkText(text, limit).map((content) => ({ tag: "markdown", content })) },
  };
}

export function notifyCard(text, limit = CARD_LIMIT) {
  return toCard(text, limit);
}

export function decideProgressMode(code) {
  if (code === 0) return "reaction";
  if (PERMISSION_ERRORS.has(Number(code))) return "card";
  return "none";
}

export function createRuntime({ client, log, chatId, allowedUser = DEFAULT_ALLOWED, chunkLimit = CARD_LIMIT }) {
  async function send(target, msgType, content, extra = {}) {
    const res = await client.im.v1.message.reply({
      path: { message_id: target.messageId },
      data: { msg_type: msgType, content: JSON.stringify(content), ...extra },
    });
    if (res.code !== 0) throw Object.assign(new Error(`reply ${res.code} ${res.msg}`), { code: res.code });
    return res.data?.message_id ?? null;
  }

  const runtime = {
    async onProgress(ctx) {
      try {
        const res = await client.im.v1.messageReaction.create({
          path: { message_id: ctx.messageId },
          data: { reaction_type: { emoji_type: PROGRESS_EMOJI } },
        });
        const mode = decideProgressMode(res.code);
        if (mode === "reaction") {
          return { mode: "reaction", messageId: ctx.messageId, reactionId: res.data?.reaction_id ?? null };
        }
        if (mode === "card") {
          const cardId = await send({ messageId: ctx.messageId }, "interactive", toCard("⏳ 处理中…"), ctx.threadId ? { reply_in_thread: true } : {}).catch((error) => {
            log("warn", "progress-card", String(error));
            return null;
          });
          if (cardId) return { mode: "card", messageId: cardId, reactionId: null };
        }
        log("warn", "progress-unavailable", res.code, res.msg);
        return null;
      } catch (error) {
        log("warn", "progress", String(error));
        return null;
      }
    },

    async onProgressDone(ctx) {
      const entry = ctx.progress;
      if (entry?.mode !== "reaction" || !entry.reactionId) return;
      try {
        const res = await client.im.v1.messageReaction.delete({ path: { message_id: entry.messageId ?? ctx.messageId, reaction_id: entry.reactionId } });
        if (res.code !== 0) log("warn", "progress-delete", res.code, res.msg);
      } catch (error) {
        log("warn", "progress-delete", String(error));
      }
    },

    async reply(ctx, text) {
      const entry = ctx.progress;
      const parts = chunkText(text, chunkLimit);
      if (entry?.mode === "card" && entry.messageId && parts.length) {
        try {
          const res = await client.im.v1.message.patch({ path: { message_id: entry.messageId }, data: { content: JSON.stringify(toCard(parts[0])) } });
          if (res?.code === 0 || res?.code === undefined) {
            for (const part of parts.slice(1)) await replyOnce(ctx, part);
            return { messageId: entry.messageId, patched: true };
          }
          log("warn", "patch", res.code, res.msg);
        } catch (error) {
          log("warn", "patch", String(error));
        }
      }
      let last = null;
      for (const part of parts) last = (await replyOnce(ctx, part)) ?? last;
      return last ? { messageId: last } : null;
    },

    async edit(ctx, messageId, text) {
      try {
        const res = await client.im.v1.message.patch({ path: { message_id: messageId }, data: { content: JSON.stringify(toCard(text)) } });
        if (res?.code === 0 || res?.code === undefined) return true;
        log("warn", "edit", res.code, res.msg);
        return false;
      } catch (error) {
        log("warn", "edit", String(error));
        return false;
      }
    },

    async notify(text) {
      const body = text.includes("<at ") ? text : `<at id=${allowedUser}></at> ${text}`;
      const res = await client.im.v1.message.create({
        params: { receive_id_type: "chat_id" },
        data: { receive_id: chatId, msg_type: "interactive", content: JSON.stringify(notifyCard(body)) },
      });
      if (res.code !== 0) throw new Error(`notify ${res.code} ${res.msg}`);
      return res.data?.message_id ?? null;
    },
  };

  async function replyOnce(ctx, part) {
    const extra = ctx.threadId ? { reply_in_thread: true } : {};
    try {
      return await send({ messageId: ctx.messageId }, "interactive", toCard(part), extra);
    } catch (error) {
      log("warn", "card-fallback", String(error));
      return await send({ messageId: ctx.messageId }, "text", { text: part }, extra);
    }
  }

  return runtime;
}

export async function defaultClientFactory({ appId, appSecret }) {
  const lark = await import("@larksuiteoapi/node-sdk");
  return new lark.default.Client({
    appId,
    appSecret,
    domain: lark.default.Domain.Feishu,
    loggerLevel: lark.default.LoggerLevel.warn,
  });
}

export function createAdapter({ paths, readEnv, log: baseLog, createClient = defaultClientFactory, loadSdk = () => import("@larksuiteoapi/node-sdk") }) {
  const env = { ...readEnv(join(paths.configDir, "feishu.env")), ...process.env };
  const appId = env.FEISHU_APP_ID;
  const appSecret = env.FEISHU_APP_SECRET;
  const chatId = env.FEISHU_CHAT_ID;
  const allowedUser = env.RELAY_ALLOWED_USER ?? DEFAULT_ALLOWED;
  const log = baseLog;
  let state = null;
  let coreRef = null;
  let runtime = null;

  async function ensureRuntime() {
    if (runtime) return runtime;
    if (!appId || !appSecret) {
      log("error", "missing-credential", "FEISHU_APP_ID / FEISHU_APP_SECRET");
      process.exit(1);
    }
    runtime = createRuntime({ client: await createClient({ appId, appSecret }), log, chatId, allowedUser });
    return runtime;
  }

  const adapter = {
    name: "feishu",
    allowedUser,
    chunkLimit: CARD_LIMIT,
    timeoutMs: Number(process.env.RELAY_TIMEOUT_MS ?? 20 * 60_000),
    maxWorkers: Number(process.env.RELAY_MAX_WORKERS ?? 2),
    queueDepth: Number(process.env.RELAY_QUEUE_DEPTH ?? 3),
    worker: process.env.RELAY_WORKER ?? "pi",
    piBin: join(paths.home, ".bun/bin/pi"),
    replyRules,

    async start({ onMessage, onReady, core }) {
      coreRef = core;
      state = core.state;
      await ensureRuntime();
      const lark = await loadSdk();

      const dispatcher = new lark.default.EventDispatcher({}).register({
        "im.message.receive_v1": async (data) => {
          const message = data?.message ?? {};
          const verdict = isAcceptedSender(data?.sender, allowedUser);
          if (!verdict.ok) {
            log("ignore", verdict.why, message.message_id ?? "");
            return { code: 0 };
          }
          const text = stripMentions(textOf(message), message.mentions);
          if (!text) {
            log("ignore", "empty", message.message_id ?? "");
            return { code: 0 };
          }
          const key = conversationKey(message);
          const inbound = {
            key,
            session: sessionFor(key),
            dedupeId: message.message_id,
            authorId: verdict.openId,
            text,
            chatId: message.chat_id ?? chatId,
            messageId: message.message_id,
            threadId: message.thread_id ?? null,
            rootText: text,
          };
          onMessage(inbound).catch((error) => log("error", "handle", String(error)));
          return { code: 0 };
        },
      });

      const ws = new lark.default.WSClient({
        appId,
        appSecret,
        domain: lark.default.Domain.Feishu,
        loggerLevel: lark.default.LoggerLevel.warn,
        autoReconnect: true,
        onReady: () => {
          log("info", "ws-ready");
          onReady?.();
        },
        onError: (error) => log("error", "ws", String(error?.message ?? error)),
      });

      log("info", "start", `allowed=${allowedUser}`, `state=${join(paths.configDir, "relay-feishu.json")}`);
      setInterval(() => {
        const now = Date.now();
        let dropped = 0;
        for (const [key, entry] of Object.entries(state.convs)) {
          const seen = Date.parse(entry?.lastMsgTs ?? "");
          if (Number.isFinite(seen) && now - seen > 30 * 86_400_000) {
            delete state.convs[key];
            dropped += 1;
          }
        }
        if (dropped) {
          coreRef?.save();
          log("info", "convs-pruned", `dropped=${dropped}`);
        }
      }, 86_400_000).unref();

      ws.start({ eventDispatcher: dispatcher });
      return new Promise(() => {});
    },

    async reply(ctx, text) {
      return (await ensureRuntime()).reply(ctx, text);
    },

    async edit(ctx, messageId, text) {
      return (await ensureRuntime()).edit(ctx, messageId, text);
    },

    async onProgress(ctx) {
      return (await ensureRuntime()).onProgress(ctx);
    },

    async onProgressDone(ctx) {
      return (await ensureRuntime()).onProgressDone(ctx);
    },

    async notify(text) {
      const id = await (await ensureRuntime()).notify(text);
      process.stdout.write(`sent ${id ? 1 : 0}\n`);
    },
  };

  return adapter;
}
