import test from "node:test";
import assert from "node:assert/strict";
import {
  alignSegment,
  buildPlan,
  clipToWindow,
  CLOCK_DEFAULTS,
  dayKey,
  filterShort,
  groupByDay,
  oversizeDays,
  countedSegments,
  planReconcile,
  pruneMissing,
  pruneSynced,
  unionSegments,
} from "./clock.mjs";

const MIN = 60_000;
const HOUR = 3_600_000;
const TZ = "Asia/Shanghai";

function at(iso) {
  return Date.parse(iso);
}

test("TC-C1 union merges segments whose gap is within the threshold", () => {
  const merged = unionSegments(
    [
      { start: at("2026-10-24T01:00:00Z"), end: at("2026-10-24T01:10:00Z") },
      { start: at("2026-10-24T01:20:00Z"), end: at("2026-10-24T01:30:00Z") },
      { start: at("2026-10-24T02:00:00Z"), end: at("2026-10-24T02:10:00Z") },
    ],
    15 * MIN,
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].end - merged[0].start, 30 * MIN);
});

test("TC-C2 alignment floors the start and ceils the end to whole minutes", () => {
  const aligned = alignSegment({ start: at("2026-10-24T01:00:20.400Z"), end: at("2026-10-24T01:10:39.900Z") });
  assert.equal(new Date(aligned.start).toISOString(), "2026-10-24T01:00:00.000Z");
  assert.equal(new Date(aligned.end).toISOString(), "2026-10-24T01:11:00.000Z");
});

test("TC-C3 segments shorter than the minimum are dropped", () => {
  const kept = filterShort(
    [
      { start: 0, end: 4 * MIN },
      { start: 10 * MIN, end: 15 * MIN },
    ],
    5 * MIN,
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0].end - kept[0].start, 5 * MIN);
});

test("TC-C4 clipping drops old segments and trims the one crossing the window edge", () => {
  const now = at("2026-10-24T12:00:00Z");
  const clipped = clipToWindow(
    [
      { start: now - 30 * HOUR, end: now - 26 * HOUR },
      { start: now - 25 * HOUR, end: now - 23 * HOUR },
    ],
    { now, hours: 24 },
  );
  assert.equal(clipped.length, 1);
  assert.equal(clipped[0].start, now - 24 * HOUR);
  assert.equal(clipped[0].end, now - 23 * HOUR);
});

test("TC-C5 a day over the warn threshold is reported with its minutes", () => {
  const day = at("2026-10-24T02:00:00Z");
  const oversize = oversizeDays(
    [
      { start: day, end: day + 13 * HOUR },
    ],
    { tz: TZ, warnHours: 12 },
  );
  assert.equal(oversize.length, 1);
  assert.equal(oversize[0].day, dayKey(day, TZ));
  assert.equal(oversize[0].minutes, 780);
});

test("TC-C6 reconcile creates missing targets, patches drifted ones and deletes orphans", () => {
  const plan = planReconcile({
    targets: [
      { start: 0, end: 10 * MIN },
      { start: 20 * MIN, end: 30 * MIN },
    ],
    current: [
      { id: "keep", start: 0, end: 10 * MIN },
      { id: "drift", start: 20 * MIN, end: 25 * MIN },
      { id: "orphan", start: 40 * MIN, end: 50 * MIN },
    ],
    thresholdMs: MIN,
  });
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.patch, [{ id: "drift", start: 20 * MIN, end: 30 * MIN }]);
  assert.deepEqual(plan.remove, ["orphan"]);
});

test("TC-C7 a target without any overlapping record is created", () => {
  const plan = planReconcile({
    targets: [{ start: 0, end: 10 * MIN }],
    current: [{ id: "other", start: 20 * MIN, end: 30 * MIN }],
  });
  assert.equal(plan.create.length, 1);
  assert.deepEqual(plan.remove, ["other"]);
});

test("TC-C8 a target overlapping two of our records pairs with the first and deletes the rest", () => {
  const plan = planReconcile({
    targets: [{ start: 0, end: 30 * MIN }],
    current: [
      { id: "a", start: 0, end: 10 * MIN },
      { id: "b", start: 12 * MIN, end: 30 * MIN },
    ],
    thresholdMs: MIN,
  });
  assert.deepEqual(plan.patch, [{ id: "a", start: 0, end: 30 * MIN }]);
  assert.deepEqual(plan.remove, ["b"]);
});

test("TC-C9 buildPlan counts only counted units, keeps a 48h backfill and ignores synced rows outside it", () => {
  const now = at("2026-10-24T12:00:00Z");
  const judged = [
    {
      unit: { runs: [{ startedAt: now - 2 * HOUR, endedAt: now - 2 * HOUR + 20 * MIN }] },
      result: { kind: "count" },
    },
    {
      unit: { runs: [{ startedAt: now - 4 * HOUR, endedAt: now - 4 * HOUR + 20 * MIN }] },
      result: { kind: "skip" },
    },
    {
      unit: { runs: [{ startedAt: now - 30 * HOUR, endedAt: now - 30 * HOUR + 20 * MIN }] },
      result: { kind: "count" },
    },
    {
      unit: { runs: [{ startedAt: now - 60 * HOUR, endedAt: now - 60 * HOUR + 20 * MIN }] },
      result: { kind: "count" },
    },
  ];
  const synced = {
    "2026-10-20": [{ id: "old", start: now - 4 * 24 * HOUR, end: now - 4 * 24 * HOUR + 10 * MIN }],
  };
  const cfg = { ...CLOCK_DEFAULTS, tz: TZ };
  const plan = buildPlan({ judged, now, cfg, synced });
  assert.equal(plan.targets.length, 2);
  assert.equal(plan.create.length, 2);
  assert.equal(plan.targets[0].start, now - 30 * HOUR);
  assert.deepEqual(plan.remove, []);
});

test("TC-C10 buildPlan drops every target of a day that exceeds the warn threshold", () => {
  const now = at("2026-10-24T12:00:00Z");
  const judged = [
    {
      unit: { runs: [{ startedAt: now - 13 * HOUR, endedAt: now - 13 * HOUR + 13 * HOUR }] },
      result: { kind: "count" },
    },
  ];
  const plan = buildPlan({ judged, now, cfg: { ...CLOCK_DEFAULTS, tz: TZ }, synced: {} });
  assert.equal(plan.targets.length, 0);
  assert.equal(plan.blocked.length, 1);
  assert.equal(plan.dropped, 1);
});

test("TC-C11 synced pruning drops stale days and stale rows", () => {
  const now = at("2026-10-24T12:00:00Z");
  const pruned = pruneSynced(
    {
      "2026-10-20": [{ id: "a", start: now - 4 * 24 * HOUR, end: now - 4 * 24 * HOUR + MIN }],
      "2026-10-24": [{ id: "b", start: now - HOUR, end: now }],
    },
    { now, tz: TZ, ttlDays: 2 },
  );
  assert.deepEqual(Object.keys(pruned), ["2026-10-24"]);
});

test("TC-C12 grouping buckets records by the local day of their start", () => {
  const grouped = groupByDay(
    [
      { start: at("2026-10-23T16:30:00Z"), end: at("2026-10-23T17:00:00Z") },
      { start: at("2026-10-24T02:00:00Z"), end: at("2026-10-24T03:00:00Z") },
    ],
    TZ,
  );
  assert.deepEqual(Object.keys(grouped).sort(), ["2026-10-24"]);
});

test("TC-C13 rows missing from the server are forgotten so the next round rebuilds them", () => {
  const now = at("2026-10-24T12:00:00Z");
  const { synced, dropped } = pruneMissing(
    {
      "2026-10-24": [
        { id: "gone", start: now - 2 * HOUR, end: now - HOUR },
        { id: "alive", start: now - HOUR, end: now },
      ],
    },
    new Set(["alive"]),
    { windowFrom: now - 24 * HOUR },
  );
  assert.equal(dropped, 1);
  assert.deepEqual(synced["2026-10-24"].map((row) => row.id), ["alive"]);
});

test("TC-C14 rows older than the verification window are kept untouched", () => {
  const now = at("2026-10-24T12:00:00Z");
  const { synced, dropped } = pruneMissing(
    { "2026-10-20": [{ id: "old", start: now - 5 * 24 * HOUR, end: now - 5 * 24 * HOUR + HOUR }] },
    new Set(),
    { windowFrom: now - 24 * HOUR },
  );
  assert.equal(dropped, 0);
  assert.equal(synced["2026-10-20"].length, 1);
});

function unitOf(key, runs) {
  return { key, runs };
}

test("countedSegments merges only inside a unit and skips excluded runs", () => {
  const base = at("2026-10-24T09:00:00Z");
  const judged = [
    {
      unit: unitOf("u1", [
        { startedAt: base, endedAt: base + 5 * MIN },
        { startedAt: base + 7 * MIN, endedAt: base + 12 * MIN },
        { startedAt: base + 15 * MIN, endedAt: base + 20 * MIN },
      ]),
      result: { kind: "count" },
    },
    {
      unit: unitOf("u2", [{ startedAt: base + 21 * MIN, endedAt: base + 26 * MIN }]),
      result: { kind: "count" },
    },
  ];
  const segments = countedSegments(judged, { gapMs: 2 * MIN });
  assert.equal(segments.length, 3);
  assert.equal(segments[0].start, base);
  assert.equal(segments[0].end, base + 12 * MIN);
  assert.equal(segments[1].start, base + 15 * MIN);
  assert.equal(segments[2].start, base + 21 * MIN);
  assert.deepEqual(segments[2].unitKeys, ["u2"]);
});

test("countedSegments never merges across a run excluded by the split verdict", () => {
  const base = at("2026-10-24T09:00:00Z");
  const judged = [
    {
      unit: unitOf("u1", [
        { startedAt: base, endedAt: base + 5 * MIN },
        { startedAt: base + 6 * MIN, endedAt: base + 8 * MIN },
        { startedAt: base + 9 * MIN, endedAt: base + 14 * MIN },
      ]),
      result: {
        kind: "count",
        split: true,
        runs: [
          { runHash: "a", kind: "count" },
          { runHash: "b", kind: "skip" },
          { runHash: "c", kind: "count" },
        ],
      },
    },
  ];
  const segments = countedSegments(judged, { gapMs: 2 * MIN });
  assert.equal(segments.length, 2);
  assert.equal(segments[0].end, base + 5 * MIN);
  assert.equal(segments[1].start, base + 9 * MIN);
  assert.equal(segments[0].origin, "run-split");
});

test("buildPlan reports the planned minutes and keeps one minute segments", () => {
  const now = at("2026-10-24T12:00:00Z");
  const judged = [
    {
      unit: unitOf("u1", [
        { startedAt: now - 2 * HOUR, endedAt: now - 2 * HOUR + 20 * MIN },
        { startedAt: now - 2 * HOUR + 22 * MIN, endedAt: now - 2 * HOUR + 24 * MIN },
      ]),
      result: { kind: "count" },
    },
  ];
  const plan = buildPlan({ judged, now, cfg: { ...CLOCK_DEFAULTS, tz: TZ }, synced: {} });
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.minutes, 24);
  assert.equal(CLOCK_DEFAULTS.mergeGapMinutes, 2);
  assert.equal(CLOCK_DEFAULTS.minSegmentMinutes, 1);
  assert.equal(CLOCK_DEFAULTS.maxWritesPerRun, 120);
});

test("buildPlan merges segments that touch after minute alignment", () => {
  const now = at("2026-10-24T12:00:00Z");
  const judged = [
    {
      unit: unitOf("u1", [
        { startedAt: now - 2 * HOUR, endedAt: now - 2 * HOUR + 5 * MIN },
        { startedAt: now - 2 * HOUR + 5 * MIN + 20_000, endedAt: now - 2 * HOUR + 10 * MIN },
      ]),
      result: { kind: "count" },
    },
  ];
  const plan = buildPlan({ judged, now, cfg: { ...CLOCK_DEFAULTS, tz: TZ }, synced: {} });
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.targets[0].end - plan.targets[0].start, 10 * MIN);
});
