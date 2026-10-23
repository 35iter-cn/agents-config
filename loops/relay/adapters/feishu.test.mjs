import test from "node:test";
import assert from "node:assert/strict";
import { conversationKey, sessionFor, textOf, textOfMessage, stripMentions, isAcceptedSender, toCard, decideProgressMode, createRuntime, createAdapter } from "./feishu.mjs";

function fakeClient({ reaction = { code: 0, data: { reaction_id: "r1" } }, reply = { code: 0, data: { message_id: "m-out" } }, patch = { code: 0 }, create = { code: 0, data: { message_id: "m-notify" } } } = {}) {
  const calls = [];
  const client = {
    im: {
      v1: {
        message: {
          reply: async (args) => {
            calls.push(["reply", args]);
            return typeof reply === "function" ? reply(args) : reply;
          },
          create: async (args) => {
            calls.push(["create", args]);
            return typeof create === "function" ? create(args) : create;
          },
          patch: async (args) => {
            calls.push(["patch", args]);
            return typeof patch === "function" ? patch(args) : patch;
          },
        },
        messageReaction: {
          create: async (args) => {
            calls.push(["reaction.create", args]);
            return typeof reaction === "function" ? reaction(args) : reaction;
          },
          delete: async (args) => {
            calls.push(["reaction.delete", args]);
            return { code: 0 };
          },
        },
      },
    },
  };
  return { client, calls };
}

const inbound = { key: "th-x", session: "fs-th-x", dedupeId: "om_1", text: "hi", chatId: "oc_1", messageId: "om_1", threadId: "om_root" };

test("TC-8 four message shapes map to four conversation keys", () => {
  assert.equal(conversationKey({ thread_id: "t1", root_id: "r1", parent_id: "p1", message_id: "m1" }), "th-t1");
  assert.equal(conversationKey({ root_id: "r1", parent_id: "p1", message_id: "m1" }), "th-r1");
  assert.equal(conversationKey({ parent_id: "p1", message_id: "m1" }), "th-p1");
  assert.equal(conversationKey({ message_id: "m1" }), "ms-m1");
  assert.equal(sessionFor("th-x"), "fs-th-x");
});

test("message content is parsed without crashing on rich payloads", () => {
  assert.equal(textOf({ content: '{"text":"你好"}' }), "你好");
  assert.equal(textOf({ content: "not json" }), "not json");
  assert.equal(textOf({}), "");
});

test("app senders and outsiders are rejected", () => {
  assert.deepEqual(isAcceptedSender({ sender_type: "app", sender_id: { open_id: "ou_me" } }, "ou_me"), { ok: false, why: "bot" });
  assert.deepEqual(isAcceptedSender({ sender_type: "user", sender_id: { open_id: "ou_other" } }, "ou_me"), { ok: false, why: "author" });
  assert.deepEqual(isAcceptedSender({ sender_type: "user", sender_id: { open_id: "ou_me" } }, "ou_me"), { ok: true, openId: "ou_me" });
});

test("cards are schema 2.0 markdown elements split at 3000 characters", () => {
  const single = toCard("**粗体**");
  assert.equal(single.schema, "2.0");
  assert.deepEqual(single.body.elements, [{ tag: "markdown", content: "**粗体**" }]);
  const long = toCard("a".repeat(6500));
  assert.equal(long.body.elements.length, 3);
});

test("permission errors downgrade the progress signal to a card", () => {
  assert.equal(decideProgressMode(0), "reaction");
  assert.equal(decideProgressMode(99991672), "card");
  assert.equal(decideProgressMode(99991400), "card");
  assert.equal(decideProgressMode(500), "none");
});

test("TC-15 the progress reaction is added and removed", async () => {
  const { client, calls } = fakeClient();
  const runtime = createRuntime({ client, log: () => {}, chatId: "oc_1" });
  const progress = await runtime.onProgress(inbound);
  assert.equal(progress.mode, "reaction");
  await runtime.onProgressDone({ ...inbound, progress });
  assert.deepEqual(calls.map(([name]) => name), ["reaction.create", "reaction.delete"]);
  assert.equal(calls[0][1].path.message_id, "om_1");
  assert.equal(calls[0][1].data.reaction_type.emoji_type, "THINKING");
  assert.equal(calls[1][1].path.reaction_id, "r1");
});

test("TC-15 the reaction is removed even when the worker fails or times out", async () => {
  const { client, calls } = fakeClient();
  const runtime = createRuntime({ client, log: () => {}, chatId: "oc_1" });
  const progress = await runtime.onProgress(inbound);
  await runtime.reply({ ...inbound, progress }, "已终止：本轮超过 20 分钟未结束。");
  await runtime.onProgressDone({ ...inbound, progress });
  assert.equal(calls.filter(([name]) => name === "reaction.delete").length, 1);
  assert.equal(calls.filter(([name]) => name === "reply").length, 1);
});

test("TC-16 without reaction permission a placeholder card is patched into the answer", async () => {
  const { client, calls } = fakeClient({ reaction: { code: 99991672, msg: "no scope" } });
  const runtime = createRuntime({ client, log: () => {}, chatId: "oc_1" });
  const progress = await runtime.onProgress(inbound);
  assert.equal(progress.mode, "card");
  await runtime.reply({ ...inbound, progress }, "最终回答");
  const names = calls.map(([name]) => name);
  assert.deepEqual(names, ["reaction.create", "reply", "patch"]);
  const patched = JSON.parse(calls[2][1].data.content);
  assert.equal(patched.body.elements[0].content, "最终回答");
});

test("TC-16 a failed patch falls back to a normal reply instead of losing the answer", async () => {
  const { client, calls } = fakeClient({ reaction: { code: 99991672, msg: "no scope" }, patch: { code: 230001, msg: "cannot patch" } });
  const runtime = createRuntime({ client, log: () => {}, chatId: "oc_1" });
  const progress = await runtime.onProgress(inbound);
  await runtime.reply({ ...inbound, progress }, "最终回答");
  const replies = calls.filter(([name]) => name === "reply").map(([, args]) => args.data.content);
  assert.ok(replies.some((content) => content.includes("最终回答")));
});

test("TC-9 a failed card reply degrades to plain text with the same body", async () => {
  let first = true;
  const { client, calls } = fakeClient({
    reply: () => {
      if (first) {
        first = false;
        return { code: 230002, msg: "card rejected" };
      }
      return { code: 0, data: { message_id: "m-text" } };
    },
  });
  const runtime = createRuntime({ client, log: () => {}, chatId: "oc_1" });
  await runtime.reply(inbound, "**粗体** 内容");
  const [cardCall, textCall] = calls.map(([, args]) => args);
  assert.equal(cardCall.data.msg_type, "interactive");
  assert.equal(textCall.data.msg_type, "text");
  assert.match(textCall.data.content, /粗体/);
});

test("TC-17 notify sends a card whose first line mentions Hao", async () => {
  const { client, calls } = fakeClient();
  const runtime = createRuntime({ client, log: () => {}, chatId: "oc_1", allowedUser: "ou_me" });
  await runtime.notify("intake loop 发现 1 个候选\n[20261022-2100-1] 一句依据");
  const [name, args] = calls[0];
  assert.equal(name, "create");
  assert.equal(args.data.msg_type, "interactive");
  const card = JSON.parse(args.data.content);
  assert.match(card.body.elements[0].content, /^<at id=ou_me><\/at>/);
  assert.match(card.body.elements[0].content, /20261022-2100-1/);
});

test("notify does not double the at tag when the caller already wrote one", async () => {
  const { client, calls } = fakeClient();
  const runtime = createRuntime({ client, log: () => {}, chatId: "oc_1", allowedUser: "ou_me" });
  await runtime.notify("<at id=ou_me></at> 已有 at");
  const card = JSON.parse(calls[0][1].data.content);
  assert.equal(card.body.elements[0].content.match(/<at /g).length, 1);
});

const adapterPaths = { configDir: "/tmp/relay-test-config", home: "/tmp/relay-test-home" };
const adapterEnv = { FEISHU_APP_ID: "cli_test", FEISHU_APP_SECRET: "secret", FEISHU_CHAT_ID: "oc_1" };

function captureStdout() {
  const original = process.stdout.write;
  const out = [];
  process.stdout.write = (chunk) => {
    out.push(String(chunk));
    return true;
  };
  return { out, restore: () => { process.stdout.write = original; } };
}

test("TC-N1 notify sends before start() was ever called", async () => {
  const { client, calls } = fakeClient();
  const adapter = createAdapter({
    paths: adapterPaths,
    readEnv: () => adapterEnv,
    log: () => {},
    createClient: async () => client,
  });
  const captured = captureStdout();
  try {
    await adapter.notify("intake 候选一条");
  } finally {
    captured.restore();
  }
  const createCalls = calls.filter(([name]) => name === "create");
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0][1].data.msg_type, "interactive");
  const card = JSON.parse(createCalls[0][1].data.content);
  assert.match(card.body.elements[0].content, /^<at id=ou_[0-9a-f]+><\/at>/);
  assert.equal(captured.out.join(""), "sent 1\n");
});

test("TC-N2 missing credentials log one line and exit instead of a TypeError", async () => {
  const logs = [];
  const exits = [];
  const originalExit = process.exit;
  process.exit = (code) => {
    exits.push(code);
    throw new Error(`exit ${code}`);
  };
  try {
    const adapter = createAdapter({
      paths: adapterPaths,
      readEnv: () => ({ FEISHU_CHAT_ID: "oc_1" }),
      log: (...parts) => logs.push(parts.map(String).join(" ")),
      createClient: async () => {
        throw new Error("createClient must not be called without credentials");
      },
    });
    await assert.rejects(() => adapter.notify("x"), /exit 1/);
  } finally {
    process.exit = originalExit;
  }
  assert.ok(logs.some((line) => line.includes("missing-credential")));
  assert.deepEqual(exits, [1]);
});

test("TC-N4 a platform error surfaces the code instead of being swallowed", async () => {
  const { client } = fakeClient({ create: { code: 99991672, msg: "no scope" } });
  const adapter = createAdapter({
    paths: adapterPaths,
    readEnv: () => adapterEnv,
    log: () => {},
    createClient: async () => client,
  });
  const captured = captureStdout();
  try {
    await assert.rejects(() => adapter.notify("x"), /99991672/);
  } finally {
    captured.restore();
  }
});

test("TC-N3 notify then start() shares one client and one websocket", async () => {
  let created = 0;
  const { client } = fakeClient();
  const instances = { ws: 0, dispatchers: 0 };
  const sdk = {
    default: {
      Client: function Client() {},
      EventDispatcher: function EventDispatcher() {
        instances.dispatchers += 1;
        this.register = () => this;
      },
      WSClient: function WSClient() {
        instances.ws += 1;
        this.start = () => {};
      },
      Domain: { Feishu: "feishu" },
      LoggerLevel: { warn: 4 },
    },
  };
  const adapter = createAdapter({
    paths: adapterPaths,
    readEnv: () => adapterEnv,
    log: () => {},
    createClient: async () => {
      created += 1;
      return client;
    },
    loadSdk: async () => sdk,
  });
  const captured = captureStdout();
  try {
    await adapter.notify("先 notify");
  } finally {
    captured.restore();
  }
  adapter.start({ onMessage: async () => {}, core: { state: { convs: {} }, save: () => {} } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created, 1);
  assert.equal(instances.ws, 1);
  assert.equal(instances.dispatchers, 1);
  assert.equal(captured.out.join(""), "sent 1\n");
});

test("TC-28 the feishu reply context survives a JSON round trip", async () => {
  const { client, calls } = fakeClient();
  const runtime = createRuntime({ client, log: () => {}, chatId: "oc_1" });
  const progress = await runtime.onProgress(inbound);
  const ctx = JSON.parse(JSON.stringify({ ...inbound, progress }));
  const sent = await runtime.reply(ctx, "恢复后的回帖");
  assert.deepEqual(sent, { messageId: "m-out" });
  assert.equal(calls.filter(([name]) => name === "reply").length, 1);
  await runtime.onProgressDone(ctx);
  assert.equal(calls.filter(([name]) => name === "reaction.delete").length, 1);
});

test("TC-28 feishu edit patches an existing message and reports failure honestly", async () => {
  const { client, calls } = fakeClient();
  const runtime = createRuntime({ client, log: () => {}, chatId: "oc_1" });
  assert.equal(await runtime.edit(inbound, "m-out", "更新后的正文"), true);
  assert.equal(calls.at(-1)[0], "patch");
  const failing = createRuntime({ client: fakeClient({ patch: { code: 230001, msg: "no" } }).client, log: () => {}, chatId: "oc_1" });
  assert.equal(await failing.edit(inbound, "m-out", "x"), false);
});

test("mentions are stripped with mentions[].key instead of scanning for @", () => {
  const mentions = [
    { key: "@_user_1", name: "Nova" },
    { key: "@_user_2", name: "Hao" },
  ];
  assert.equal(stripMentions("@_user_1 帮我看下 #5753", mentions), "帮我看下 #5753");
  assert.equal(stripMentions("@_user_1 @_user_2 都看一下", mentions), "都看一下");
  assert.equal(stripMentions("@_user_1 /重跑", mentions), "/重跑");
  assert.equal(stripMentions("@_user_1", mentions), "");
  assert.equal(stripMentions("没有 mention 的正文", mentions), "没有 mention 的正文");
  assert.equal(stripMentions("@_user_1 没有映射表时原样保留", []), "@_user_1 没有映射表时原样保留");
  assert.equal(stripMentions("邮箱 hao@example.com", mentions), "邮箱 hao@example.com");
});

test("TC-R0 textOfMessage extracts text, card markdown and rejects media", () => {
  assert.equal(textOfMessage({ msg_type: "text", body: { content: '{"text":"你好"}' } }), "你好");
  assert.equal(
    textOfMessage({ msg_type: "interactive", body: { content: JSON.stringify({ body: { elements: [{ tag: "markdown", content: "候选一\n候选二" }] } }) } }),
    "候选一\n候选二",
  );
  assert.equal(
    textOfMessage({ msg_type: "post", body: { content: JSON.stringify({ zh_cn: { title: "标题", content: [[{ tag: "text", text: "正文" }]] } }) } }).includes("正文"),
    true,
  );
  assert.equal(textOfMessage({ msg_type: "image", body: { content: '{"image_key":"k"}' } }), null);
  assert.equal(textOfMessage(null), null);
});

function rootHarness({ get, convs = {} } = {}) {
  const handlers = {};
  const calls = [];
  const client = {
    im: {
      v1: {
        message: {
          reply: async (args) => ({ code: 0, data: { message_id: "m-out" } }),
          patch: async () => ({ code: 0 }),
          get: async (args) => {
            calls.push(args);
            return get(args);
          },
        },
        messageReaction: { create: async () => ({ code: 0 }), delete: async () => ({ code: 0 }) },
      },
    },
  };
  const sdk = {
    default: {
      Client: function Client() {},
      EventDispatcher: function EventDispatcher() {
        this.register = (map) => { Object.assign(handlers, map); return this; };
      },
      WSClient: function WSClient() { this.start = () => {}; },
      Domain: { Feishu: "feishu" },
      LoggerLevel: { warn: 4 },
    },
  };
  const state = { convs: { ...convs }, save: () => {} };
  const seen = [];
  const adapter = createAdapter({
    paths: adapterPaths,
    readEnv: () => adapterEnv,
    log: () => {},
    createClient: async () => client,
    loadSdk: async () => sdk,
  });
  const started = adapter.start({ onMessage: async (msg) => seen.push(msg), core: { state, save: () => {} } });
  started.catch(() => {});
  return { adapter, started, handlers, calls, seen, state };
}

test("TC-R1 the reply-chain root supplies rootText via user_card_content", async () => {
  const { ready, handlers, calls, seen } = rootHarness({
    get: async () => ({
      code: 0,
      data: { items: [{ msg_type: "interactive", body: { content: JSON.stringify({ body: { elements: [{ tag: "markdown", content: "候选一\n候选二" }] } }) } }] },
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await handlers["im.message.receive_v1"]({
    sender: { sender_type: "user", sender_id: { open_id: "ou_ce8b91019c8e721b5b47ff89b4a78fba" } },
    message: { message_id: "om_child", root_id: "om_root", chat_id: "oc_1", message_type: "text", content: '{"text":"go"}', mentions: [] },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path.message_id, "om_root");
  assert.equal(calls[0].params.card_msg_content_type, "user_card_content");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].rootText, "候选一\n候选二");
});

test("TC-R2 a group message without root_id never fetches a root", async () => {
  const { ready, handlers, calls, seen } = rootHarness({ get: async () => ({ code: 0, data: { items: [] } }) });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await handlers["im.message.receive_v1"]({
    sender: { sender_type: "user", sender_id: { open_id: "ou_ce8b91019c8e721b5b47ff89b4a78fba" } },
    message: { message_id: "om_solo", chat_id: "oc_1", message_type: "text", content: '{"text":"读一下"}', mentions: [] },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.length, 0);
  assert.equal(seen[0].rootText, null);
});

test("TC-R3 root fetch gives up after three failures", async () => {
  let attempts = 0;
  const { ready, handlers, calls, seen } = rootHarness({
    get: async () => {
      attempts += 1;
      throw new Error("gateway down");
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const event = (id) => ({
    sender: { sender_type: "user", sender_id: { open_id: "ou_ce8b91019c8e721b5b47ff89b4a78fba" } },
    message: { message_id: id, root_id: "om_root", chat_id: "oc_1", message_type: "text", content: '{"text":"go"}', mentions: [] },
  });
  for (const id of ["om_a", "om_b", "om_c"]) {
    await handlers["im.message.receive_v1"](event(id));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const callsAfterThree = calls.length;
  await handlers["im.message.receive_v1"](event("om_d"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(callsAfterThree, 3);
  assert.equal(calls.length, 3);
  assert.equal(seen.at(-1).rootText, null);
});
