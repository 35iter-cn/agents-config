import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ANSWER_HEAD_CHARS = 200;
const MAGIC_STATE_CHARS = 1_000;

export function createUsage(deps = {}) {
  const clock = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});
  const dir = deps.dir;
  const judge = deps.judge ?? null;
  const write = deps.write ?? appendFileSync;

  async function judgeMagic(text, answer) {
    if (typeof judge?.judgeChoice !== "function") return { magic: "unknown", confidence: null, fallback: "nokey" };
    const verdict = await judge.judgeChoice({
      id: "run-magic",
      state: `${text}\n\n---\n\n${answer.slice(0, MAGIC_STATE_CHARS)}`,
      instructions: "这一轮 agent 在做的事，是否属于 MagicDoor 的工作？",
      criteria: {
        magic_work: "处理 MagicDoor 相关事务：代码、issue、PR、看板、工时、内部系统、公司工具",
        non_magic: "与 MagicDoor 无关：个人事务、其他项目、闲聊、环境杂务",
        unknown: "信息不足以判断",
      },
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
        ? await judgeMagic(input, output)
        : { magic: "unknown", confidence: null, fallback: status };
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
