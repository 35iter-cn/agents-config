const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export const CLOCK_DEFAULTS = {
  enabled: false,
  baseUrl: "https://focus.35iter.cn",
  activityName: "clock",
  activityId: null,
  minSegmentMinutes: 5,
  warnDailyHours: 12,
  changeThresholdMs: MINUTE_MS,
  unionGapMinutes: 15,
  backfillHours: 48,
  maxWritesPerRun: 50,
  syncedTtlDays: 7,
};

export function dayKey(ms, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function runSegments(runs) {
  return runs
    .filter((run) => Number.isFinite(run.startedAt) && Number.isFinite(run.endedAt) && run.endedAt > run.startedAt)
    .map((run) => ({ start: run.startedAt, end: run.endedAt }));
}

export function unionSegments(segments, gapMs) {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const out = [];
  for (const segment of sorted) {
    const last = out[out.length - 1];
    if (last && segment.start - last.end <= gapMs) {
      last.end = Math.max(last.end, segment.end);
      continue;
    }
    out.push({ start: segment.start, end: segment.end });
  }
  return out;
}

export function alignSegment({ start, end }) {
  return { start: Math.floor(start / MINUTE_MS) * MINUTE_MS, end: Math.ceil(end / MINUTE_MS) * MINUTE_MS };
}

export function filterShort(segments, minMs) {
  return segments.filter((segment) => segment.end - segment.start >= minMs);
}

export function clipToWindow(segments, { now, hours }) {
  const from = now - hours * HOUR_MS;
  return segments
    .map((segment) => ({ start: Math.max(segment.start, from), end: segment.end }))
    .filter((segment) => segment.end > segment.start);
}

export function oversizeDays(segments, { tz, warnHours }) {
  const limit = warnHours * HOUR_MS;
  const sums = new Map();
  for (const segment of segments) {
    const key = dayKey(segment.start, tz);
    sums.set(key, (sums.get(key) ?? 0) + (segment.end - segment.start));
  }
  return [...sums.entries()]
    .filter(([, ms]) => ms > limit)
    .map(([day, ms]) => ({ day, minutes: Math.round(ms / MINUTE_MS) }));
}

export function planReconcile({ targets, current, thresholdMs = MINUTE_MS }) {
  const create = [];
  const patch = [];
  const remove = [];
  const used = new Set();
  for (const target of [...targets].sort((a, b) => a.start - b.start)) {
    const match = [...current]
      .filter((item) => !used.has(item.id) && item.start < target.end && item.end > target.start)
      .sort((a, b) => a.start - b.start)[0];
    if (!match) {
      create.push(target);
      continue;
    }
    used.add(match.id);
    if (Math.abs(match.start - target.start) > thresholdMs || Math.abs(match.end - target.end) > thresholdMs) {
      patch.push({ id: match.id, start: target.start, end: target.end });
    }
  }
  for (const item of current) {
    if (!used.has(item.id)) remove.push(item.id);
  }
  return { create, patch, remove };
}

export function buildPlan({ judged, now, cfg, synced }) {
  const counted = judged.filter((entry) => entry.result.kind === "count");
  const runs = counted.flatMap((entry) => runSegments(entry.unit.runs));
  const merged = unionSegments(runs, cfg.unionGapMinutes * MINUTE_MS);
  const clipped = clipToWindow(merged, { now, hours: cfg.backfillHours });
  const aligned = clipped.map(alignSegment);
  const targets = filterShort(aligned, cfg.minSegmentMinutes * MINUTE_MS);
  const oversize = oversizeDays(targets, { tz: cfg.tz, warnHours: cfg.warnDailyHours });
  const blocked = new Set(oversize.map((item) => item.day));
  const usable = targets.filter((segment) => !blocked.has(dayKey(segment.start, cfg.tz)));
  const from = now - cfg.backfillHours * HOUR_MS;
  const current = Object.values(synced ?? {})
    .flat()
    .filter((item) => item.end > from)
    .map((item) => ({ id: item.id, start: item.start, end: item.end }));
  return {
    targets: usable,
    blocked: oversize,
    dropped: targets.length - usable.length,
    ...planReconcile({ targets: usable, current, thresholdMs: cfg.changeThresholdMs }),
  };
}

export function groupByDay(records, tz) {
  const out = {};
  for (const record of records) {
    const key = dayKey(record.start, tz);
    (out[key] ??= []).push(record);
  }
  return out;
}

export function pruneSynced(synced, { now, tz, ttlDays }) {
  const out = {};
  for (const [day, records] of Object.entries(synced ?? {})) {
    const anchor = Date.parse(`${day}T00:00:00Z`);
    if (Number.isFinite(anchor) && now - anchor > ttlDays * 24 * HOUR_MS) continue;
    const kept = records.filter((record) => record.end >= now - ttlDays * 24 * HOUR_MS);
    if (kept.length) out[day] = kept;
  }
  return out;
}

export function pruneMissing(synced, liveIds, { windowFrom }) {
  const out = {};
  let dropped = 0;
  for (const [day, records] of Object.entries(synced ?? {})) {
    const kept = records.filter((record) => record.end < windowFrom || liveIds.has(record.id));
    dropped += records.length - kept.length;
    if (kept.length) out[day] = kept;
  }
  return { synced: out, dropped };
}
