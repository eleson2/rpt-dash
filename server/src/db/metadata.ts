import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { config, metadataPath } from "../config.js";

mkdirSync(config.dataDir, { recursive: true });

export const meta = new Database(metadataPath);
meta.pragma("journal_mode = WAL");
meta.pragma("foreign_keys = ON");

// Schema is created idempotently on startup. For a small single-file metadata
// store this is simpler than a migration framework; revisit if it grows.
meta.exec(`
  CREATE TABLE IF NOT EXISTS datasets (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL UNIQUE,   -- logical view name in DuckDB
    source_path  TEXT NOT NULL,
    format       TEXT NOT NULL,          -- 'parquet' | 'csv' | 'json'
    columns      TEXT NOT NULL,          -- JSON: [{ name, type }] (curated, as exposed by the view)
    row_estimate INTEGER,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Per-column curation overlay for a dataset view: friendly labels and
  -- visibility. The DuckDB view is rebuilt from this (SELECT phys AS label, …),
  -- so it is the source of truth for renames/hides and is re-applied on startup.
  CREATE TABLE IF NOT EXISTS column_meta (
    dataset    TEXT NOT NULL,            -- DuckDB view name
    column     TEXT NOT NULL,            -- physical column name (from the file)
    label      TEXT,                     -- friendly alias; NULL → use physical name
    visible    INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER,
    PRIMARY KEY (dataset, column)
  );

  CREATE TABLE IF NOT EXISTS metrics (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    sql         TEXT NOT NULL,
    params      TEXT NOT NULL DEFAULT '[]',  -- JSON: [{ name, type }]
    viz         TEXT NOT NULL DEFAULT '{}',  -- JSON: { type, xField, yFields }
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS dashboards (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    layout     TEXT NOT NULL DEFAULT '[]', -- JSON: [{ metricId, w, h }]
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,          -- scrypt: salt:derivedKey (hex)
    role          TEXT NOT NULL DEFAULT 'viewer', -- 'admin' | 'viewer'
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,          -- epoch ms
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/** Add a column to a table if it does not already exist (lightweight migration). */
function addColumnIfMissing(table: string, column: string, ddl: string) {
  const cols = meta.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    meta.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

// Visual reports are stored as metrics with kind='visual' and a structured spec
// (so they can be re-edited without parsing SQL). 'sql' metrics leave spec NULL.
addColumnIfMissing("metrics", "kind", "kind TEXT NOT NULL DEFAULT 'sql'");
addColumnIfMissing("metrics", "spec", "spec TEXT");
addColumnIfMissing("metrics", "owner_id", "owner_id TEXT");
// Server-side bound values for a metric's baked-in placeholders (e.g. a visual
// report's filter values). Supplied to the query on every run; not user-facing.
addColumnIfMissing("metrics", "fixed_params", "fixed_params TEXT NOT NULL DEFAULT '{}'");

// Physical schema of a dataset's underlying file(s), kept alongside the curated
// `columns` so the column editor can still show original names/types after a
// view rename. JSON: [{ name, type }].
addColumnIfMissing("datasets", "raw_columns", "raw_columns TEXT");

// How a dataset surfaces to users: 'table' = a logical data source (a combined
// per-type view or an uploaded file) shown in the UI; 'file' = an internal
// per-file entry from discovery, hidden behind the combined view.
addColumnIfMissing("datasets", "kind", "kind TEXT NOT NULL DEFAULT 'table'");
