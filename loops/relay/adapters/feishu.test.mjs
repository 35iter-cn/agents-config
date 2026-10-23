import test from "node:test";
import assert from "node:assert/strict";
import { conversationKey, sessionFor, textOf, isAcceptedSender, toCard, decideProgressMode, createRuntime, createAdapter } from "./feishu.mjs";

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
  assert.equal(await runtime.onProgress(inbound), "reaction");
  await runtime.onProgressDone(inbound);
  assert.deepEqual(calls.map(([name]) => name), ["reaction.create", "reaction.delete"]);
  assert.equal(calls[0][1].path.message_id, "om_1");
  assert.equal(calls[0][1].data.reaction_type.emoji_type, "THINKING");
  assert.equal(calls[1][1].path.reaction_id, "r1");
});

test("TC-15 the reaction is removed even when the worker fails or times out", async () => {
  const { client, calls } = fakeClient();
  const runtime = createRuntime({ client, log: () => {}, chatId: "oc_1" });
  await runtime.onProgress(inbound);
  await runtime.reply(inbound, "已终止：本轮超过 20 分钟未结束。");
  await runtime.onProgressDone(inbound);
  assert.equal(calls.filter(([name]) => name === "reaction.delete").length, 1);
  assert.equal(calls.filter(([name]) => name === "reply").length, 1);
});

test("TC-16 without reaction permission a placeholder card is patched into the answer", async () => {
  const { client, calls } = fakeClient({ reaction: { code: 99991672, msg: "no scope" } });
  const runtime = createRuntime({ client, log: () => {}, chatId: "oc_1" });
  assert.equal(await runtime.onProgress(inbound), "card");
  await runtime.reply(inbound, "最终回答");
  const names = calls.map(([name]) => name);
  assert.deepEqual(names, ["reaction.create", "reply", "patch"]);
  const patched = JSON.parse(calls[2][1].data.content);
  assert.equal(patched.body.elements[0].content, "最终回答");
});

test("TC-16 a failed patch falls back to a normal reply instead of losing the answer", async () => {
  const { client, calls } = fakeClient({ reaction: { code: 99991672, msg: "no scope" }, patch: { code: 230001, msg: "cannot patch" } });
  const runtime = createRuntime({ client, log: () => {}, chatId: "oc_1" });
  await runtime.onProgress(inbound);
  await runtime.reply(inbound, "最终回答");
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
