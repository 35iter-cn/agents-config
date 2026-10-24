#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createJev } from "../relay/jev.mjs";

const HOME = process.env.HOME ?? homedir();
const ROOT = dirname(fileURLToPath(import.meta.url));
const BUN_BIN = process.env.AGENT_HOURS_BUN ?? (typeof Bun !== "undefined" ? process.execPath : "bun");
const NOTIFY_CHUNK_CHARS = 2400;
const CFG_DIR = join(HOME, ".config/agent-hours");
const LEDGER_DIR = join(CFG_DIR, "ledger");
const DECISIONS_FILE = join(CFG_DIR, "decisions.json");
const REVIEW_DIR = join(CFG_DIR, "review");
const DIGEST_DIR = join(CFG_DIR, "digest");
const JEV_ENV = join(HOME, ".config/taskradar/jev.env");
const RELAY_ENTRY = join(ROOT, "../relay/relay.mjs");

export const DEFAULTS = {
  tz: "Asia/Shanghai",
  gapMinutes: 15,
  settleMinutes: 5,
  countMinP: 0.5,
  marginMin: 0.1,
  reviewLongRunHours: 4,
  maxUnitsPerRun: 30,
  notify: { platform: "feishu", enabled: true },
};

const LEDGER_WINDOW_MS = 48 * 60 * 60 * 1000;
const USER_TEXT_LIMIT = 1200;
const OUTPUT_LIMIT = 1200;
const DECISIONS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_PREVIEW = 60;
const OUTPUT_PREVIEW = 100;

export const JUDGE_INSTRUCTIONS =
  "判产出物的归属，不判有没有动手、也不判产出量大小。" +
  "计入：改 MagicDoor 仓库的代码或配置、跑它的测试、查它的数据与日志、操作客户内部系统、" +
  "写 MagicDoor 的方案 / 计划 / 评估 / 文档。" +
  "不计入：个人事务、闲聊、只复述上下文或只确认状态；以及自家工具与基建的维护" +
  "（relay、intake loop、工时账本、Pi 插件、taskradar）和环境搭建 / 排障，" +
  "即使这一轮交付了一段能跑的代码或一份文档。" +
  "判定看产出物归谁，不看消息是发给谁、也不看改了几行。";

export const JUDGE_CRITERIA = {
  count: "产出物属于 MagicDoor 客户项目，应当计入工时",
  skip: "产出物不归客户项目：无实质产出、个人事务、闲聊，或自家工具 / 基建维护与环境排障",
};

export function loadConfig(dir = CFG_DIR) {
  const file = join(dir, "config.json");
  if (!existsSync(file)) return { ...DEFAULTS };
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return {
    ...DEFAULTS,
    ...parsed,
    notify: { ...DEFAULTS.notify, ...(parsed.notify ?? {}) },
  };
}

export function readLedger(dir = LEDGER_DIR, { now = Date.now(), windowMs = LEDGER_WINDOW_MS } = {}) {
  if (!existsSync(dir)) return [];
  const records = [];
  for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".jsonl"))) {
    const file = join(dir, name);
    if (now - statSync(file).mtimeMs > windowMs) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        const startedAt = Date.parse(record.startedAt);
        if (Number.isNaN(startedAt) || now - startedAt > windowMs) continue;
        records.push(record);
      } catch {
        continue;
      }
    }
  }
  return records;
}

export function buildUnits(records, { gapMs = DEFAULTS.gapMinutes * 60_000 } = {}) {
  const bySession = new Map();
  for (const record of records) {
    if (record.source === "automation") continue;
    if (record.aborted) continue;
    if (!String(record.userText ?? "").trim()) continue;
    const startedAt = Date.parse(record.startedAt);
    if (Number.isNaN(startedAt)) continue;
    const run = { startedAt, durationMs: Number(record.durationMs) || 0, userText: record.userText, output: record.output ?? "" };
    run.endedAt = startedAt + run.durationMs;
    const bucket = bySession.get(record.sessionId) ?? [];
    bucket.push(run);
    bySession.set(record.sessionId, bucket);
  }

  const units = [];
  for (const [sessionId, runs] of bySession) {
    runs.sort((a, b) => a.startedAt - b.startedAt);
    let unit = null;
    for (const run of runs) {
      const gap = unit ? run.startedAt - unit.lastEnd : Infinity;
      if (gap > gapMs) {
        if (unit) units.push(unit);
        unit = { key: `${sessionId}:${new Date(run.startedAt).toISOString()}`, sessionId, startedAt: run.startedAt, lastEnd: run.endedAt, runs: [] };
      }
      unit.runs.push(run);
      unit.lastEnd = Math.max(unit.lastEnd, run.endedAt);
    }
    if (unit) units.push(unit);
  }
  return units.sort((a, b) => b.startedAt - a.startedAt);
}

export function unitState(unit) {
  const requests = unit.runs.map((run) => String(run.userText ?? "").trim()).filter(Boolean).join("\n---\n").slice(0, USER_TEXT_LIMIT);
  const outputs = unit.runs.map((run) => String(run.output ?? "").trim()).filter(Boolean).join("\n---\n").slice(0, OUTPUT_LIMIT);
  return `【用户请求】\n${requests}\n\n【agent 产出】\n${outputs || "(无)"}`;
}

export function unitHash(unit) {
  const requests = unit.runs.map((run) => String(run.userText ?? "")).join("\n\u0000\n");
  const outputs = unit.runs.map((run) => String(run.output ?? "")).join("\n\u0000\n");
  return createHash("sha1").update(`${requests}\u0001${outputs}`).digest("hex").slice(0, 16);
}

export async function decideUnit(unit, { judge, cfg = DEFAULTS, now = Date.now(), cache = {} }) {
  const hash = unitHash(unit);
  const cached = cache[unit.key];
  if (cached && cached.hash === hash) return { ...cached.result, cached: true, notifiedHash: cached.notifiedHash ?? null };

  const longest = unit.runs.reduce((max, run) => Math.max(max, run.durationMs), 0);
  if (longest >= cfg.reviewLongRunHours * 3600 * 1000) {
    return { kind: "review", reason: "long-run", p: null, margin: null, cached: false };
  }

  const verdict = await judge.judgeChoice({
    id: `hours:${unit.key}`,
    state: unitState(unit),
    instructions: JUDGE_INSTRUCTIONS,
    criteria: JUDGE_CRITERIA,
  });

  const probabilities = verdict.probabilities ?? null;
  const count = probabilities?.count;
  const skip = probabilities?.skip;
  const margin = typeof count === "number" && typeof skip === "number" ? Math.abs(count - skip) : null;

  if (verdict.fallback) return { kind: "review", reason: verdict.fallback, p: probabilities, margin, cached: false };
  if (typeof count !== "number" || margin === null) return { kind: "review", reason: "no-probability", p: probabilities, margin, cached: false };
  if (margin < cfg.marginMin) return { kind: "review", reason: "low-margin", p: probabilities, margin, cached: false };
  return { kind: count >= cfg.countMinP ? "count" : "skip", reason: null, p: probabilities, margin, cached: false };
}

export function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
}

export function pruneDecisions(cache, { now = Date.now(), ttlMs = DECISIONS_TTL_MS } = {}) {
  const kept = {};
  for (const [key, entry] of Object.entries(cache)) {
    const judgedAt = Date.parse(entry.judgedAt ?? "");
    if (Number.isNaN(judgedAt) || now - judgedAt <= ttlMs) kept[key] = entry;
  }
  return kept;
}

export function formatClock(ms, tz) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ms));
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("hour")}:${pick("minute")}`;
}

export function formatDay(ms, tz) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function preview(text, limit) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

const BADGE = { count: "计入", skip: "不计", review: "待确认" };

export function formatEntry(unit, result, { tz }) {
  const minutes = Math.round((unit.lastEnd - unit.startedAt) / 60_000);
  const span = `${formatClock(unit.startedAt, tz)}–${formatClock(unit.lastEnd, tz)}`;
  const head = `${BADGE[result.kind]} ${span} · ${minutes}min · ${unit.runs.length} 轮 · ${unit.sessionId.slice(0, 18)}`;
  const prob = result.p ? ` · p=${Number(result.p.count).toFixed(2)}` : "";
  const reason = result.kind === "review" ? ` · ${result.reason}` : "";
  const last = unit.runs.at(-1);
  const lines = [`${head}${prob}${reason}`];
  lines.push(`  问：${preview(last.userText, REQUEST_PREVIEW)}`);
  if (String(last.output ?? "").trim()) lines.push(`  答：${preview(last.output, OUTPUT_PREVIEW)}`);
  return lines.join("\n");
}

export function formatReport(fresh, { tz, now = Date.now() }) {
  if (!fresh.length) return "";
  const counts = fresh.reduce((acc, item) => {
    acc[item.result.kind] = (acc[item.result.kind] ?? 0) + 1;
    return acc;
  }, {});
  const countedMinutes = fresh
    .filter((item) => item.result.kind === "count")
    .reduce((sum, item) => sum + (item.unit.lastEnd - item.unit.startedAt) / 60_000, 0);
  const head = [
    `工时判定 · ${formatClock(now, tz)}`,
    `新增 ${fresh.length} 个单元：计入 ${counts.count ?? 0} / 不计 ${counts.skip ?? 0} / 待确认 ${counts.review ?? 0}`,
    `判定为计入的单元跨度合计 ${Math.round(countedMinutes)} 分钟（未去重，写入 Clock 时才取并集）`,
  ].join("\n");
  const body = fresh.map((item) => formatEntry(item.unit, item.result, { tz })).join("\n\n");
  return `${head}\n\n${body}`;
}

function notifyFeishu(text, { platform }) {
  const chunks = chunkMessage(text);
  const results = chunks.map((chunk) =>
    spawnSync(BUN_BIN, [RELAY_ENTRY, "notify", platform, chunk], { encoding: "utf8", timeout: 30_000 }),
  );
  const failed = results.find((result) => result.status !== 0);
  return {
    ok: !failed,
    chunks: chunks.length,
    output: failed ? `${failed.stdout ?? ""}${failed.stderr ?? ""}`.trim() : "",
  };
}

export function chunkMessage(text, limit = NOTIFY_CHUNK_CHARS) {
  const blocks = String(text ?? "").split("\n\n");
  const chunks = [];
  let buffer = "";
  for (const block of blocks) {
    if (buffer && buffer.length + block.length + 2 > limit) {
      chunks.push(buffer);
      buffer = block;
    } else {
      buffer = buffer ? `${buffer}\n\n${block}` : block;
    }
    while (buffer.length > limit) {
      chunks.push(buffer.slice(0, limit));
      buffer = buffer.slice(limit);
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks.length ? chunks : [];
}

function appendDigest(line, { dir = CFG_DIR, now, tz }) {
  const digestDir = join(dir, "digest");
  mkdirSync(digestDir, { recursive: true });
  appendFileSync(join(digestDir, `${formatDay(now, tz)}.md`), `${line}\n`);
}

function appendReview(day, payload, { dir = CFG_DIR } = {}) {
  const reviewDir = join(dir, "review");
  mkdirSync(reviewDir, { recursive: true });
  appendFileSync(join(reviewDir, `${day}.jsonl`), `${JSON.stringify(payload)}\n`);
}

function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

export async function run({
  now = Date.now(),
  dir = CFG_DIR,
  judge = null,
  dryRun = false,
  notify = true,
  notifyImpl = notifyFeishu,
  log = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  const cfg = loadConfig(dir);
  const decisionsFile = join(dir, "decisions.json");
  const cache = existsSync(decisionsFile) ? JSON.parse(readFileSync(decisionsFile, "utf8")) : {};
  const engine = judge ?? createJev({ env: { ...process.env, ...readEnvFile(JEV_ENV) } });

  const units = buildUnits(readLedger(join(dir, "ledger"), { now }))
    .filter((unit) => now - unit.lastEnd >= cfg.settleMinutes * 60_000)
    .slice(0, cfg.maxUnitsPerRun);

  const fresh = [];
  for (const unit of units) {
    const result = await decideUnit(unit, { judge: engine, cfg, now, cache });
    const previous = cache[unit.key];
    const notifiedHash = previous?.notifiedHash ?? null;
    const hash = unitHash(unit);
    const changed = !previous || previous.hash !== hash;
    if (changed) {
      cache[unit.key] = { hash, result, notifiedHash, judgedAt: new Date(now).toISOString() };
    }
    if (!dryRun && result.kind === "review" && changed) {
      appendReview(formatDay(unit.startedAt, cfg.tz), {
        key: unit.key,
        reason: result.reason,
        span: [new Date(unit.startedAt).toISOString(), new Date(unit.lastEnd).toISOString()],
        p: result.p,
        requests: unit.runs.map((run) => preview(run.userText, 200)),
        outputs: unit.runs.map((run) => preview(run.output, 200)),
      }, { dir });
    }
    if (notifiedHash !== hash) fresh.push({ unit, result, hash });
  }

  const report = formatReport(fresh, { tz: cfg.tz, now });
  let delivered = false;
  if (!dryRun) {
    writeJsonAtomic(decisionsFile, pruneDecisions(cache, { now }));
    if (report && notify && cfg.notify.enabled) {
      const sent = notifyImpl(report, { platform: cfg.notify.platform });
      delivered = sent.ok;
      if (!sent.ok) log(`[error] notify: ${sent.output}`);
      else {
        for (const item of fresh) cache[item.unit.key].notifiedHash = item.hash;
        writeJsonAtomic(decisionsFile, pruneDecisions(cache, { now }));
      }
    }
    const counts = fresh.reduce((acc, item) => {
      acc[item.result.kind] = (acc[item.result.kind] ?? 0) + 1;
      return acc;
    }, {});
    appendDigest(
      `- ${formatClock(now, cfg.tz)} 单元 ${units.length} / 新增 ${fresh.length}（计入 ${counts.count ?? 0}、不计 ${counts.skip ?? 0}、待确认 ${counts.review ?? 0}）· 飞书 ${report ? (delivered ? "已发" : "未发") : "无新增"}`,
      { dir, now, tz: cfg.tz },
    );
  }

  return { units: units.length, fresh, report, delivered, cache };
}

function resolveEntry() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === entry;
  } catch {
    return false;
  }
}

async function main(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const dryRun = flags.has("--dry-run");
  const notify = !flags.has("--no-notify");
  const outcome = await run({ dryRun, notify });
  if (dryRun) process.stdout.write(`${outcome.report || "(no new units)"}\n`);
  process.stderr.write(`[hours] units=${outcome.units} fresh=${outcome.fresh.length} notified=${outcome.delivered}\n`);
}

if (resolveEntry()) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`[hours] ${error?.stack ?? error}\n`);
    process.exit(1);
  });
}
