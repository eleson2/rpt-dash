import { runQuery } from "../db/duckdb.js";

export type FileFormat = "parquet" | "csv" | "json";

export interface ColumnInfo {
  name: string;
  type: string;
}

/** Map a file format to the DuckDB reader function that scans it in place. */
export function readerFor(format: FileFormat, absPath: string): string {
  // DuckDB string literals treat backslash literally, but normalize to forward
  // slashes for cross-platform consistency. Single quotes are escaped by doubling.
  const p = absPath.replace(/\\/g, "/").replace(/'/g, "''");
  switch (format) {
    case "parquet":
      return `read_parquet('${p}')`;
    case "csv":
      return `read_csv_auto('${p}')`;
    case "json":
      return `read_json_auto('${p}')`;
  }
}

/**
 * Reader for a set of parquet files matched by a glob, unioned into one table.
 * `union_by_name` tolerates schema drift across files; `filename` and
 * `hive_partitioning` surface each row's source path and any `key=value`
 * path segments (e.g. year=/month=) as columns. Re-evaluated on every query,
 * so files added later are picked up without re-registering.
 */
export function parquetGlobReader(globPath: string): string {
  const p = globPath.replace(/\\/g, "/").replace(/'/g, "''");
  return `read_parquet('${p}', union_by_name=true, filename=true, hive_partitioning=true)`;
}

export function formatFromFilename(name: string): FileFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".parquet") || lower.endsWith(".pq")) return "parquet";
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) return "csv";
  if (lower.endsWith(".json") || lower.endsWith(".ndjson") || lower.endsWith(".jsonl")) return "json";
  return null;
}

export interface Introspection {
  columns: ColumnInfo[];
  rowEstimate: number;
  preview: Record<string, unknown>[];
}

/** Inspect a staged file: column schema, row count, and a small preview. */
export async function introspect(format: FileFormat, absPath: string): Promise<Introspection> {
  return introspectReader(readerFor(format, absPath));
}

/** Inspect any DuckDB reader expression: column schema, row count, preview. */
export async function introspectReader(reader: string): Promise<Introspection> {
  const desc = await runQuery(`DESCRIBE SELECT * FROM ${reader}`);
  const columns: ColumnInfo[] = desc.rows.map((r) => ({
    name: String(r["column_name"]),
    type: String(r["column_type"]),
  }));

  const countRes = await runQuery(`SELECT count(*) AS n FROM ${reader}`);
  const rowEstimate = Number(countRes.rows[0]?.["n"] ?? 0);

  const previewRes = await runQuery(`SELECT * FROM ${reader} LIMIT 20`);

  return { columns, rowEstimate, preview: previewRes.rows };
}
