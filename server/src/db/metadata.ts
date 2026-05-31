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
    columns      TEXT NOT NULL,          -- JSON: [{ name, type }]
    row_estimate INTEGER,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
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
`);
