import { config } from "../config.js";
import { listDatasets } from "../ingest/upload.js";
import type { Viz } from "../metrics/types.js";
import type { Dimension, Measure, ReportSpec } from "./types.js";

export interface BuiltQuery {
  sql: string;
  params: Record<string, unknown>;
  viz: Viz;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Whether a DuckDB column type can be bucketed by year/month/day. Date/time
 * types cast cleanly, and strings are parsed at query time; numeric, boolean,
 * and other types cannot be cast to DATE/TIMESTAMP and would fail mid-query.
 */
function isTemporalCastable(type: string): boolean {
  const t = type.toUpperCase();
  return (
    t.includes("DATE") ||
    t.includes("TIMESTAMP") ||
    t.includes("TIME") ||
    t.includes("VARCHAR") ||
    t.includes("CHAR") ||
    t.includes("STRING") ||
    t.includes("TEXT")
  );
}

/**
 * Whether a DuckDB column type is numeric. `sum`/`avg` only accept numeric (and
 * interval) inputs; applying them to text/other types fails at query time.
 */
function isNumericType(type: string): boolean {
  const t = type.toUpperCase();
  return (
    t.includes("INT") || // TINYINT..BIGINT, HUGEINT, U*INT (also INTERVAL, which avg accepts)
    t.includes("DECIMAL") ||
    t.includes("NUMERIC") ||
    t.includes("DOUBLE") ||
    t.includes("FLOAT") ||
    t.includes("REAL")
  );
}

function dimExpr(d: Dimension): string {
  const q = quoteIdent(d.column);
  switch (d.transform) {
    case "year":
      return `EXTRACT(year FROM CAST(${q} AS TIMESTAMP))`;
    case "month":
      return `date_trunc('month', CAST(${q} AS TIMESTAMP))`;
    case "day":
      return `CAST(${q} AS DATE)`;
    default:
      return q;
  }
}

function dimAlias(d: Dimension): string {
  return d.transform === "none" ? d.column : `${d.column}_${d.transform}`;
}

function measureExpr(m: Measure): string {
  if (m.agg === "count" && !m.column) return "count(*)";
  return `${m.agg}(${quoteIdent(m.column!)})`;
}

function measureAlias(m: Measure): string {
  if (m.agg === "count" && !m.column) return "count";
  return `${m.agg}_${m.column}`;
}

/** Ensure alias uniqueness within a SELECT list. */
function uniquify(aliases: string[]): string[] {
  const seen = new Map<string, number>();
  return aliases.map((a) => {
    const n = seen.get(a) ?? 0;
    seen.set(a, n + 1);
    return n === 0 ? a : `${a}_${n + 1}`;
  });
}

/**
 * Translate a structured report spec into safe SQL. All identifiers are
 * validated against the dataset's catalog columns (a fixed allowlist), and all
 * literal values are bound as parameters — the browser never supplies SQL.
 */
export function buildReportSql(spec: ReportSpec): BuiltQuery {
  const dataset = listDatasets().find((d) => d.name === spec.dataset);
  if (!dataset) throw new Error(`Unknown dataset: ${spec.dataset}`);
  const columnTypes = new Map(dataset.columns.map((c) => [c.name, c.type]));

  const requireColumn = (col: string) => {
    if (!columnTypes.has(col)) throw new Error(`Unknown column "${col}" in dataset ${spec.dataset}`);
  };

  // Validate all referenced columns up front.
  for (const d of spec.dimensions) {
    requireColumn(d.column);
    if (d.transform !== "none" && !isTemporalCastable(columnTypes.get(d.column)!)) {
      throw new Error(
        `Cannot apply "${d.transform}" bucketing to column "${d.column}" ` +
          `(type ${columnTypes.get(d.column)}). Date bucketing requires a date, ` +
          `timestamp, or text column.`,
      );
    }
  }
  for (const m of spec.measures) {
    if (m.agg !== "count" && !m.column) throw new Error(`${m.agg} requires a column`);
    if (m.column) requireColumn(m.column);
    if ((m.agg === "sum" || m.agg === "avg") && m.column && !isNumericType(columnTypes.get(m.column)!)) {
      throw new Error(
        `Cannot apply "${m.agg}" to column "${m.column}" (type ${columnTypes.get(m.column)}). ` +
          `Sum and average require a numeric column.`,
      );
    }
  }
  for (const f of spec.filters) requireColumn(f.column);

  const dimAliases = uniquify(spec.dimensions.map(dimAlias));
  const measureAliases = uniquify(spec.measures.map(measureAlias));

  const selectParts: string[] = [];
  spec.dimensions.forEach((d, i) => selectParts.push(`${dimExpr(d)} AS ${quoteIdent(dimAliases[i]!)}`));
  spec.measures.forEach((m, i) =>
    selectParts.push(`${measureExpr(m)} AS ${quoteIdent(measureAliases[i]!)}`),
  );

  const params: Record<string, unknown> = {};
  const whereParts: string[] = [];
  spec.filters.forEach((f, i) => {
    const q = quoteIdent(f.column);
    if (f.op === "in") {
      const values = Array.isArray(f.value) ? f.value : [f.value];
      if (values.length === 0) return;
      const keys = values.map((v, j) => {
        const key = `p${i}_${j}`;
        params[key] = v;
        return `$${key}`;
      });
      whereParts.push(`${q} IN (${keys.join(", ")})`);
    } else if (f.op === "contains") {
      const key = `p${i}`;
      params[key] = `%${String(f.value)}%`;
      whereParts.push(`CAST(${q} AS VARCHAR) ILIKE $${key}`);
    } else {
      const key = `p${i}`;
      params[key] = f.value;
      whereParts.push(`${q} ${f.op} $${key}`);
    }
  });

  const allAliases = new Set([...dimAliases, ...measureAliases]);
  let orderClause = "";
  if (spec.orderBy && allAliases.has(spec.orderBy.ref)) {
    orderClause = `ORDER BY ${quoteIdent(spec.orderBy.ref)} ${spec.orderBy.dir.toUpperCase()}`;
  } else if (spec.dimensions.length) {
    orderClause = "ORDER BY 1";
  }

  const limit = Math.min(spec.limit ?? 1000, config.maxRows);

  const sql = [
    `SELECT ${selectParts.join(", ")}`,
    `FROM ${quoteIdent(spec.dataset)}`,
    whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "",
    spec.dimensions.length ? `GROUP BY ${spec.dimensions.map((_, i) => i + 1).join(", ")}` : "",
    orderClause,
    `LIMIT ${limit}`,
  ]
    .filter(Boolean)
    .join(" ");

  const viz: Viz = {
    type: spec.viz.type,
    xField: dimAliases[0],
    yFields: measureAliases,
  };

  return { sql, params, viz };
}
