import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "rptdash-curation-"));

const { meta } = await import("../src/db/metadata.js");
const { buildSelectList, curatedColumns, setCuration, validateCuration } = await import(
  "../src/ingest/curation.js"
);
const { createMetric, getMetric } = await import("../src/metrics/store.js");
const { migrateVisualReports } = await import("../src/reports/migrate.js");

const physical = [
  { name: "a", type: "INTEGER" },
  { name: "b", type: "VARCHAR" },
  { name: "source_file", type: "VARCHAR" },
];

test("buildSelectList is an identity projection when uncurated", () => {
  assert.equal(buildSelectList("ds1", physical), '"a", "b", "source_file"');
  assert.deepEqual(curatedColumns("ds1", physical), physical);
});

test("buildSelectList renames labelled columns and drops hidden ones", () => {
  setCuration("ds1", [
    { column: "a", label: "alpha", visible: true, sortOrder: 0 },
    { column: "b", label: null, visible: true, sortOrder: 1 },
    { column: "source_file", label: null, visible: false, sortOrder: 2 },
  ]);
  assert.equal(buildSelectList("ds1", physical), '"a" AS "alpha", "b"');
  assert.deepEqual(curatedColumns("ds1", physical), [
    { name: "alpha", type: "INTEGER" },
    { name: "b", type: "VARCHAR" },
  ]);
});

test("validateCuration rejects duplicate labels and a fully-hidden set", () => {
  assert.throws(
    () =>
      validateCuration([
        { column: "a", label: "x", visible: true, sortOrder: 0 },
        { column: "b", label: "x", visible: true, sortOrder: 1 },
      ]),
    /Duplicate column name/,
  );
  assert.throws(
    () => validateCuration([{ column: "a", label: null, visible: false, sortOrder: 0 }]),
    /At least one column must stay visible/,
  );
});

test("migrateVisualReports rewrites saved report specs on rename", () => {
  // Seed a dataset whose catalog reflects the *post-rename* schema.
  meta
    .prepare(
      `INSERT INTO datasets (id, name, source_path, format, columns, raw_columns, row_estimate)
       VALUES ('m1', 'msales', '/x.csv', 'csv', @cols, @cols, 10)`,
    )
    .run({
      cols: JSON.stringify([
        { name: "region2", type: "VARCHAR" },
        { name: "amount", type: "DOUBLE" },
      ]),
    });

  const metric = createMetric(
    { name: "by region", sql: "SELECT 1", params: [], viz: { type: "bar", yFields: [] } },
    {
      kind: "visual",
      spec: {
        dataset: "msales",
        dimensions: [{ column: "region", transform: "none" }],
        measures: [{ agg: "sum", column: "amount" }],
        filters: [],
        viz: { type: "bar", yFields: [] },
      },
    },
  );

  const result = migrateVisualReports("msales", new Map([["region", "region2"]]));
  assert.deepEqual(result.migrated, ["by region"]);
  assert.deepEqual(result.warnings, []);

  const updated = getMetric(metric.id)!;
  assert.equal((updated.spec as { dimensions: { column: string }[] }).dimensions[0]!.column, "region2");
  assert.match(updated.sql, /GROUP BY 1/);
  assert.match(updated.sql, /"region2"/);
});

test("migrateVisualReports warns when a referenced column is gone", () => {
  meta
    .prepare(
      `INSERT INTO datasets (id, name, source_path, format, columns, raw_columns, row_estimate)
       VALUES ('m2', 'msales2', '/x.csv', 'csv', @cols, @cols, 10)`,
    )
    .run({ cols: JSON.stringify([{ name: "amount", type: "DOUBLE" }]) });

  createMetric(
    { name: "hidden-dim", sql: "SELECT 1", params: [], viz: { type: "bar", yFields: [] } },
    {
      kind: "visual",
      spec: {
        dataset: "msales2",
        dimensions: [{ column: "region", transform: "none" }], // region was hidden
        measures: [{ agg: "count" }],
        filters: [],
        viz: { type: "bar", yFields: [] },
      },
    },
  );

  // No rename for "region" (it was hidden) → buildReportSql fails → warning.
  const result = migrateVisualReports("msales2", new Map());
  assert.deepEqual(result.warnings, ["hidden-dim"]);
});
