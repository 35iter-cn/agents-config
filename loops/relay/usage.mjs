import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ANSWER_HEAD_CHARS = 200;
const MAGIC_STATE_CHARS = 400;
const MAGIC_CONTEXT_CHARS = 1_500;

const MAGIC_ASSETS = `- 代码仓库：backend、company-portal、owner-portal、tenant-portal、magic-manager、frontend-common-module、agents-config（内部 agent 配置与工具）
- 用户口语简称：op repo / op env（owner-portal 那套）、MD STACK / md（本地全套环境）
- 内部系统：relay 与 intake loop（飞书 / Slack / Telegram 桥）、Frontend Tasks 看板、MagicDoor 工时表、Jev 判断层、topicbox
- 业务对象：property / manager / owner / tenant / vendor 门户、contribution、payment method、Plaid / Payabli 集成
- 明确不属于：影视与闲聊、纯问候、个人网络与设备排障（路由器 / VPN / 本机网络）、个人配置仓库（自己的 rules 文件）`;

const MAGIC_CRITERIA = {
  magic_work: `用户这一轮的请求指向下面清单里的任何资产、仓库、系统或业务对象，包括通过指代（「上一轮」「这个模式」「那个 bug」）承接前几轮正在做的清单内工作。\n\n${MAGIC_ASSETS}`,
  non_magic: "用户这一轮的请求与清单完全无关：影视、闲聊、纯问候、个人网络与设备排障、个人配置仓库",
  unknown: "从起始消息、前几轮与本轮请求都看不出指向清单内或清单外",
};

const MAGIC_INSTRUCTIONS =
  "判断用户这一轮的请求指向什么。短指令或指代词要靠前几轮用户消息解析出它在指哪件事。回答只是 agent 做了什么，用户打招呼或聊无关话题时即使回答里出现清单中的名字也不算 magic_work。";

export function createUsage(deps = {}) {
  const clock = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});
  const dir = deps.dir;
  const judge = deps.judge ?? null;
  const write = deps.write ?? appendFileSync;

  function judgeState(job, answer) {
    const text = String(job?.inbound?.text ?? "");
    const root = String(job?.inbound?.rootText ?? "");
    const start = root && root !== text ? root.slice(0, MAGIC_CONTEXT_CHARS) : "(无，本级即话题起点)";
    return [
      `【话题起始消息】\n${start}`,
      `【本轮用户消息】\n${text}`,
      `【agent 本轮回答（仅供参考，不是用户请求）】\n${String(answer ?? "").slice(0, MAGIC_STATE_CHARS)}`,
    ].join("\n\n");
  }

  async function judgeMagic(job, answer) {
    if (typeof judge?.judgeChoice !== "function") return { magic: "unknown", confidence: null, fallback: "nokey" };
    const verdict = await judge.judgeChoice({
      id: "run-magic",
      state: judgeState(job, answer),
      instructions: MAGIC_INSTRUCTIONS,
      criteria: MAGIC_CRITERIA,
    });
    return {
      magic: verdict.choice ?? "unknown",
      confidence: verdict.confidence ?? null,
      fallback: verdict.fallback ?? null,
    };
  }

  async function recordRun({ job, platform, key, session, answer, status, startedAt }) {
    try {
      const endedAt = clock();
      const beganAt = Number.isFinite(startedAt) ? startedAt : endedAt;
      const input = String(job?.inbound?.text ?? "");
      const output = String(answer ?? "");
      const judged = status === "done"
        ? await judgeMagic(job, output)
        : { magic: "unjudged", confidence: null, fallback: status };
      const record = {
        ts: new Date(endedAt).toISOString(),
        jobId: job?.id ?? null,
        platform,
        key,
        session,
        startedAt: new Date(beganAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        durationMs: endedAt - beganAt,
        status,
        inputChars: input.length,
        answerChars: output.length,
        magic: judged.magic,
        confidence: judged.confidence,
        fallback: judged.fallback,
      };
      if (status === "done") record.answerHead = output.slice(0, ANSWER_HEAD_CHARS);
      mkdirSync(dir, { recursive: true });
      write(join(dir, `${record.ts.slice(0, 10)}.jsonl`), `${JSON.stringify(record)}\n`);
      return record;
    } catch (error) {
      log("warn", "usage", String(error?.message ?? error));
      return null;
    }
  }

  return { recordRun };
}
