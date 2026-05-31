import { nanoid } from "nanoid";
import { meta } from "../db/metadata.js";
import { withWriteLock } from "../db/duckdb.js";
import { type ColumnInfo, type FileFormat, introspect, readerFor } from "./introspect.js";

export interface Dataset {
  id: string;
  name: string;
  sourcePath: string;
  format: FileFormat;
  columns: ColumnInfo[];
  rowEstimate: number;
  createdAt: string;
}

interface DatasetRow {
  id: string;
  name: string;
  source_path: string;
  format: FileFormat;
  columns: string;
  row_estimate: number;
  created_at: string;
}

function rowToDataset(r: DatasetRow): Dataset {
  return {
    id: r.id,
    name: r.name,
    sourcePath: r.source_path,
    format: r.format,
    columns: JSON.parse(r.columns),
    rowEstimate: r.row_estimate,
    createdAt: r.created_at,
  };
}

export function listDatasets(): Dataset[] {
  const rows = meta.prepare("SELECT * FROM datasets ORDER BY name").all() as DatasetRow[];
  return rows.map(rowToDataset);
}

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Derive a safe DuckDB view name from a desired label or filename. */
export function safeViewName(desired: string): string {
  const base = desired
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^([0-9])/, "_$1");
  return IDENT.test(base) ? base : `ds_${base}`;
}

/**
 * Register a staged file as a DuckDB view queried in place, and record it in
 * the ingest catalog. View creation is serialized via the write lock.
 */
export async function registerDataset(opts: {
  name: string;
  format: FileFormat;
  absPath: string;
}): Promise<Dataset> {
  const viewName = safeViewName(opts.name);
  if (!IDENT.test(viewName)) throw new Error(`Invalid view name: ${viewName}`);

  const info = await introspect(opts.format, opts.absPath);
  const reader = readerFor(opts.format, opts.absPath);

  await withWriteLock(async (conn) => {
    await conn.run(`CREATE OR REPLACE VIEW "${viewName}" AS SELECT * FROM ${reader}`);
  });

  const id = nanoid(12);
  meta
    .prepare(
      `INSERT INTO datasets (id, name, source_path, format, columns, row_estimate)
       VALUES (@id, @name, @source_path, @format, @columns, @row_estimate)
       ON CONFLICT(name) DO UPDATE SET
         source_path = excluded.source_path,
         format = excluded.format,
         columns = excluded.columns,
         row_estimate = excluded.row_estimate`,
    )
    .run({
      id,
      name: viewName,
      source_path: opts.absPath,
      format: opts.format,
      columns: JSON.stringify(info.columns),
      row_estimate: info.rowEstimate,
    });

  const row = meta.prepare("SELECT * FROM datasets WHERE name = ?").get(viewName) as DatasetRow;
  return rowToDataset(row);
}
