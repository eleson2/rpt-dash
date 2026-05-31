import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "rptdash-reports-"));

const { meta } = await import("../src/db/metadata.js");
const { buildReportSql } = await import("../src/reports/build.js");

// Seed a dataset directly into the catalog.
meta
  .prepare(
    `INSERT INTO datasets (id, name, source_path, format, columns, row_estimate)
     VALUES ('d1', 'sales', '/x.csv', 'csv', @cols, 10)`,
  )
  .run({
    cols: JSON.stringify([
      { name: "region", type: "VARCHAR" },
      { name: "ts", type: "DATE" },
      { name: "amount", type: "DOUBLE" },
    ]),
  });

test("builds grouped aggregate SQL with quoted identifiers", () => {
  const { sql, params, viz } = buildReportSql({
    dataset: "sales",
    dimensions: [{ column: "region", transform: "none" }],
    measures: [{ agg: "sum", column: "amount" }],
    filters: [],
    viz: { type: "bar", yFields: [] },
  });
  assert.match(sql, /sum\("amount"\) AS "sum_amount"/);
  assert.match(sql, /FROM "sales"/);
  assert.match(sql, /GROUP BY 1/);
  assert.deepEqual(params, {});
  assert.equal(viz.xField, "region");
  assert.deepEqual(viz.yFields, ["sum_amount"]);
});

test("binds filter values as parameters (no interpolation)", () => {
  const { sql, params } = buildReportSql({
    dataset: "sales",
    dimensions: [],
    measures: [{ agg: "count" }],
    filters: [{ column: "region", op: "=", value: "North" }],
    viz: { type: "table", yFields: [] },
  });
  assert.match(sql, /WHERE "region" = \$p0/);
  assert.match(sql, /count\(\*\) AS "count"/);
  assert.equal(params.p0, "North");
});

test("applies month bucketing", () => {
  const { sql } = buildReportSql({
    dataset: "sales",
    dimensions: [{ column: "ts", transform: "month" }],
    measures: [{ agg: "avg", column: "amount" }],
    filters: [],
    viz: { type: "line", yFields: [] },
  });
  assert.match(sql, /date_trunc\('month', CAST\("ts" AS TIMESTAMP\)\) AS "ts_month"/);
});

test("rejects columns not in the dataset catalog", () => {
  assert.throws(
    () =>
      buildReportSql({
        dataset: "sales",
        dimensions: [{ column: "ts; DROP TABLE x", transform: "none" }],
        measures: [{ agg: "count" }],
        filters: [],
        viz: { type: "table", yFields: [] },
      }),
    /Unknown column/,
  );
});

test("rejects unknown dataset", () => {
  assert.throws(
    () =>
      buildReportSql({
        dataset: "nope",
        dimensions: [],
        measures: [{ agg: "count" }],
        filters: [],
        viz: { type: "table", yFields: [] },
      }),
    /Unknown dataset/,
  );
});
