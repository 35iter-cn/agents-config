import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ANSWER_HEAD_CHARS = 200;
const MAGIC_STATE_CHARS = 500;
const MAGIC_CONTEXT_CHARS = 1_500;

const MAGIC_CRITERIA = {
  magic_work: "MagicDoor 相关的代码、issue、PR、看板、工时、内部系统与公司工具链（含 relay / agents-config 这类内部基础设施）",
  non_magic: "与 MagicDoor 业务无关：影视与闲聊、纯问候、个人网络与设备排障、个人配置仓库",
  unknown: "用户请求里没有任何可判定归属的信息",
};

const MAGIC_ASSET = /magicdoor|md\s*stack|\bop repo\b|owner[-\s]?portal|company[-\s]?portal|tenant[-\s]?portal|magic[-\s]?manager|frontend[-\s]?common[-\s]?module/i;
const GREETING_ONLY = /^(早|早上好|上午好|中午好|下午好|晚上好|晚安|你好|在吗|hi|hello|hey|yo)[\s!！。.,，~]*$/i;

export function createUsage(deps = {}) {
  const clock = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});
  const dir = deps.dir;
  const judge = deps.judge ?? null;
  const write = deps.write ?? appendFileSync;

  function judgeContext(job) {
    const text = String(job?.inbound?.text ?? "");
    const root = String(job?.inbound?.rootText ?? "");
    return root && root !== text ? `${root.slice(0, MAGIC_CONTEXT_CHARS)}\n\n---\n\n${text}` : text;
  }

  function ruleVerdict(context) {
    const trimmed = context.trim();
    if (GREETING_ONLY.test(trimmed)) return { magic: "non_magic", confidence: 1, fallback: null, judgeSource: "rule" };
    if (MAGIC_ASSET.test(trimmed)) return { magic: "magic_work", confidence: 1, fallback: null, judgeSource: "rule" };
    return null;
  }

  async function judgeMagic(job, answer) {
    const context = judgeContext(job);
    const byRule = ruleVerdict(context);
    if (byRule) return byRule;
    if (typeof judge?.judgeChoice !== "function") return { magic: "unknown", confidence: null, fallback: "nokey", judgeSource: "jev" };
    const verdict = await judge.judgeChoice({
      id: "run-magic",
      state: `${context}\n\n=== agent 产出（仅上下文，不作为归属依据）===\n${String(answer ?? "").slice(0, MAGIC_STATE_CHARS)}`,
      instructions: "只看会话根消息与本轮用户请求判断归属；用户只是打招呼或问无关话题时，不得因为回答提到 MagicDoor 就判 magic_work。",
      criteria: MAGIC_CRITERIA,
    });
    return {
      magic: verdict.choice ?? "unknown",
      confidence: verdict.confidence ?? null,
      fallback: verdict.fallback ?? null,
      judgeSource: "jev",
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
        : { magic: "unjudged", confidence: null, fallback: status, judgeSource: null };
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
        judgeSource: judged.judgeSource,
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
