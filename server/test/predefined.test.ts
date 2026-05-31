import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "rptdash-predef-"));

const { pivot } = await import("../src/predefined/cpuByServiceClass.js");

const rows = [
  { t: "2026-05-01 00:00:00", series: "ONLINE", v: 10 },
  { t: "2026-05-01 00:00:00", series: "Other", v: 7 },
  { t: "2026-05-01 01:00:00", series: "ONLINE", v: 12 },
  { t: "2026-05-01 01:00:00", series: "Other", v: 5 },
];

test("pivots long rows into stacked series with Other last (top of stack)", () => {
  const { categories, series } = pivot(rows, ["ONLINE"]);
  assert.deepEqual(categories, ["2026-05-01 00:00:00", "2026-05-01 01:00:00"]);
  assert.deepEqual(series.map((s) => s.name), ["ONLINE", "Other"]);
  assert.deepEqual(series[0]!.data, [10, 12]); // ONLINE
  assert.deepEqual(series[1]!.data, [7, 5]); // Other (top)
});

test("fills missing buckets with zero and sorts categories", () => {
  const sparse = [
    { t: "2026-05-01 02:00:00", series: "BATCH", v: 3 },
    { t: "2026-05-01 00:00:00", series: "BATCH", v: 1 },
  ];
  const { categories, series } = pivot(sparse, ["BATCH"]);
  assert.deepEqual(categories, ["2026-05-01 00:00:00", "2026-05-01 02:00:00"]);
  assert.deepEqual(series[0]!.data, [1, 3]);
});

test("omits series not present in the data", () => {
  const { series } = pivot(rows, ["ONLINE", "TSO"]); // TSO has no rows
  assert.deepEqual(series.map((s) => s.name), ["ONLINE", "Other"]);
});
