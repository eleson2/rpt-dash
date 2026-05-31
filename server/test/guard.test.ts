import { test } from "node:test";
import assert from "node:assert/strict";
import { assertReadOnlySql, paramValuesSchema } from "../src/metrics/types.js";

test("accepts a single SELECT statement", () => {
  assert.doesNotThrow(() => assertReadOnlySql("SELECT 1"));
  assert.doesNotThrow(() => assertReadOnlySql("WITH t AS (SELECT 1) SELECT * FROM t"));
  assert.doesNotThrow(() => assertReadOnlySql("  select a from sales where r = $r ;  "));
});

test("rejects data-modifying and DDL statements", () => {
  for (const sql of [
    "DELETE FROM sales",
    "UPDATE sales SET x = 1",
    "INSERT INTO sales VALUES (1)",
    "DROP TABLE sales",
    "CREATE VIEW v AS SELECT 1",
    "ATTACH 'x.db'",
    "COPY sales TO 'out.csv'",
  ]) {
    assert.throws(() => assertReadOnlySql(sql), new RegExp(""), `should reject: ${sql}`);
  }
});

test("rejects statement chaining", () => {
  assert.throws(() => assertReadOnlySql("SELECT 1; DROP TABLE sales"));
});

test("param schema coerces and enforces required", () => {
  const schema = paramValuesSchema([
    { name: "region", type: "string", required: true },
    { name: "limit", type: "number", required: false },
  ]);
  const ok = schema.parse({ region: "North", limit: "5" });
  assert.equal(ok.region, "North");
  assert.equal(ok.limit, 5);
  assert.throws(() => schema.parse({ limit: 5 }), undefined, "missing required region");
  assert.throws(() => schema.parse({ region: "x", extra: 1 }), undefined, "unknown param");
});
