import { nanoid } from "nanoid";
import { meta } from "../db/metadata.js";
import { withWriteLock } from "../db/duckdb.js";
import { buildSelectList, curatedColumns, quoteIdent } from "./curation.js";
import {
  type ColumnInfo,
  type FileFormat,
  introspectReader,
  parquetGlobReader,
  readerFor,
} from "./introspect.js";

/**
 * 'table' = a logical data source shown to users (a combined per-type view or
 * an uploaded file). 'file' = an internal per-file entry from discovery, hidden
 * behind its combined view.
 */
export type DatasetKind = "table" | "file";

export interface Dataset {
  id: string;
  name: string;
  sourcePath: string;
  format: FileFormat;
  kind: DatasetKind;
  /** Columns as exposed by the (curated) view — what report builders see. */
  columns: ColumnInfo[];
  /** Physical columns of the underlying file(s), before curation. */
  rawColumns: ColumnInfo[];
  rowEstimate: number;
  createdAt: string;
}

interface DatasetRow {
  id: string;
  name: string;
  source_path: string;
  format: FileFormat;
  kind: DatasetKind;
  columns: string;
  raw_columns: string | null;
  row_estimate: number;
  created_at: string;
}

function rowToDataset(r: DatasetRow): Dataset {
  const columns: ColumnInfo[] = JSON.parse(r.columns);
  return {
    id: r.id,
    name: r.name,
    sourcePath: r.source_path,
    format: r.format,
    kind: r.kind ?? "table",
    columns,
    // Older rows predate raw_columns; fall back to the curated columns.
    rawColumns: r.raw_columns ? JSON.parse(r.raw_columns) : columns,
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
 * Create (or replace) a DuckDB view from a reader expression, applying any
 * stored column curation as a `SELECT phys AS alias, …` projection, and upsert
 * the catalog row. The physical schema is recorded as `raw_columns` and the
 * curated (exposed) schema as `columns`. View creation is serialized via the
 * write lock. Shared by file uploads, glob views, and re-curation.
 */
export async function persistCuratedView(opts: {
  viewName: string;
  reader: string;
  sourcePath: string;
  format: FileFormat;
  kind?: DatasetKind;
}): Promise<Dataset> {
  const { viewName, reader } = opts;
  if (!IDENT.test(viewName)) throw new Error(`Invalid view name: ${viewName}`);

  // Physical schema of the underlying file(s), before curation.
  const physical = await introspectReader(reader);
  const selectList = buildSelectList(viewName, physical.columns);
  const exposed = curatedColumns(viewName, physical.columns);

  await withWriteLock(async (conn) => {
    await conn.run(
      `CREATE OR REPLACE VIEW ${quoteIdent(viewName)} AS SELECT ${selectList} FROM ${reader}`,
    );
  });

  const id = nanoid(12);
  meta
    .prepare(
      `INSERT INTO datasets (id, name, source_path, format, kind, columns, raw_columns, row_estimate)
       VALUES (@id, @name, @source_path, @format, @kind, @columns, @raw_columns, @row_estimate)
       ON CONFLICT(name) DO UPDATE SET
         source_path = excluded.source_path,
         format = excluded.format,
         kind = excluded.kind,
         columns = excluded.columns,
         raw_columns = excluded.raw_columns,
         row_estimate = excluded.row_estimate`,
    )
    .run({
      id,
      name: viewName,
      source_path: opts.sourcePath,
      format: opts.format,
      kind: opts.kind ?? "table",
      columns: JSON.stringify(exposed),
      raw_columns: JSON.stringify(physical.columns),
      row_estimate: physical.rowEstimate,
    });

  const row = meta.prepare("SELECT * FROM datasets WHERE name = ?").get(viewName) as DatasetRow;
  return rowToDataset(row);
}

/**
 * Register a staged file as a DuckDB view queried in place, and record it in
 * the ingest catalog.
 */
export async function registerDataset(opts: {
  name: string;
  format: FileFormat;
  absPath: string;
  kind?: DatasetKind;
}): Promise<Dataset> {
  return persistCuratedView({
    viewName: safeViewName(opts.name),
    reader: readerFor(opts.format, opts.absPath),
    sourcePath: opts.absPath,
    format: opts.format,
    kind: opts.kind ?? "table",
  });
}

/**
 * Register a DuckDB view backed by an arbitrary reader expression (e.g. a glob
 * over many parquet files unioned into one table). `sourcePath` is the human
 * label recorded in the catalog (the glob pattern). Upserts on name.
 */
export async function registerView(opts: {
  name: string;
  reader: string;
  sourcePath: string;
  format?: FileFormat;
}): Promise<Dataset> {
  return persistCuratedView({
    viewName: safeViewName(opts.name),
    reader: opts.reader,
    sourcePath: opts.sourcePath,
    format: opts.format ?? "parquet",
  });
}

/**
 * Rebuild an existing dataset's view from its current curation (call after
 * setCuration). Reuses the recorded source_path/format as the reader.
 */
export async function recurateView(viewName: string): Promise<Dataset> {
  const row = meta.prepare("SELECT * FROM datasets WHERE name = ?").get(viewName) as
    | DatasetRow
    | undefined;
  if (!row) throw new Error(`Unknown dataset: ${viewName}`);
  // Combined glob views store the glob in source_path; file datasets store the
  // staged file path. Both are valid readers for their format.
  const reader =
    row.format === "parquet" && row.source_path.includes("*")
      ? parquetGlobReader(row.source_path)
      : readerFor(row.format, row.source_path);
  return persistCuratedView({
    viewName,
    reader,
    sourcePath: row.source_path,
    format: row.format,
    kind: row.kind ?? "table",
  });
}
