import { config } from "../config.js";
import { runQuery, type QueryResult } from "../db/duckdb.js";
import {
  type Metric,
  type ParamDef,
  assertReadOnlySql,
  paramValuesSchema,
} from "./types.js";

export interface RunResult extends QueryResult {
  metricId: string;
  truncated: boolean;
}

/**
 * Execute a curated metric:
 *  1. validate/coerce incoming params against the metric's declared schema,
 *  2. re-assert the SQL is read-only (defense-in-depth),
 *  3. run with prepared-statement binding and a hard row cap.
 */
export async function runMetric(
  metric: Metric,
  rawParams: Record<string, unknown>,
): Promise<RunResult> {
  assertReadOnlySql(metric.sql);

  const values = paramValuesSchema(metric.params).parse(rawParams ?? {});

  // Convert validated values into plain JS for the binder (Date stays a Date).
  const bound: Record<string, unknown> = {};
  for (const p of metric.params) {
    if (p.name in values) bound[p.name] = (values as Record<string, unknown>)[p.name];
  }

  // Enforce a row cap by wrapping the curated query. metric.sql is a single
  // SELECT/WITH statement (validated), so this composition is safe.
  const cap = config.maxRows;
  const wrapped = `SELECT * FROM (${metric.sql}) AS _m LIMIT ${cap + 1}`;

  const result = await runQuery(wrapped, metric.params.length ? bound : undefined);

  const truncated = result.rows.length > cap;
  if (truncated) result.rows.length = cap;

  return { metricId: metric.id, truncated, ...result };
}

/**
 * Run unsaved metric SQL for the builder's preview pane. Same safety as a real
 * run (read-only check, param validation, prepared binding) but a small,
 * fixed row cap so authors get fast feedback.
 */
export async function previewQuery(input: {
  sql: string;
  params: ParamDef[];
  values: Record<string, unknown>;
  limit?: number;
}): Promise<QueryResult & { truncated: boolean }> {
  assertReadOnlySql(input.sql);
  const values = paramValuesSchema(input.params).parse(input.values ?? {});

  const bound: Record<string, unknown> = {};
  for (const p of input.params) {
    if (p.name in values) bound[p.name] = (values as Record<string, unknown>)[p.name];
  }

  const limit = Math.min(input.limit ?? 50, 500);
  const wrapped = `SELECT * FROM (${input.sql}) AS _p LIMIT ${limit + 1}`;
  const result = await runQuery(wrapped, input.params.length ? bound : undefined);

  const truncated = result.rows.length > limit;
  if (truncated) result.rows.length = limit;
  return { truncated, ...result };
}
