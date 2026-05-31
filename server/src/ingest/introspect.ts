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
  const reader = readerFor(format, absPath);

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
