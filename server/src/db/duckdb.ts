import { mkdir } from "node:fs/promises";
import {
  DuckDBInstance,
  type DuckDBConnection,
  type DuckDBValue,
} from "@duckdb/node-api";
import { config, duckdbPath } from "../config.js";

let instancePromise: Promise<DuckDBInstance> | null = null;

async function getInstance(): Promise<DuckDBInstance> {
  if (!instancePromise) {
    instancePromise = (async () => {
      await mkdir(config.dataDir, { recursive: true });
      await mkdir(config.stagingDir, { recursive: true });
      // Single read-write instance. Concurrent reads are safe within one process;
      // structural writes (ingest/DDL) are serialized via withWriteLock() below.
      return DuckDBInstance.create(duckdbPath);
    })();
  }
  return instancePromise;
}

/**
 * Open a fresh connection. DuckDB connections are not meant to be driven
 * concurrently, so each logical operation uses its own connection rather than
 * sharing one across interleaved async work.
 */
export async function getConnection(): Promise<DuckDBConnection> {
  const instance = await getInstance();
  return instance.connect();
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

/** Run a SELECT with optional named ($name) parameters and return JSON-safe rows. */
export async function runQuery(
  sql: string,
  params?: Record<string, unknown>,
): Promise<QueryResult> {
  const conn = await getConnection();
  try {
    const reader = params
      ? await conn.runAndReadAll(sql, toDuckValues(params))
      : await conn.runAndReadAll(sql);
    return {
      columns: reader.columnNames(),
      // getRowObjectsJson() yields JSON-serializable values (no bigint/temporal objects).
      rows: reader.getRowObjectsJson() as unknown as Record<string, unknown>[],
    };
  } finally {
    conn.closeSync();
  }
}

/** Coerce validated JS param values into DuckDB-bindable values. */
function toDuckValues(params: Record<string, unknown>): Record<string, DuckDBValue> {
  const out: Record<string, DuckDBValue> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      out[key] = null;
    } else if (value instanceof Date) {
      // Bind dates as ISO strings; DuckDB casts to DATE/TIMESTAMP in comparisons.
      out[key] = value.toISOString();
    } else if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      out[key] = value;
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

let tail: Promise<unknown> = Promise.resolve();

/**
 * Serialize structural writes (ingest, CREATE VIEW, imports) so they never race
 * each other. Reads are not gated.
 */
export function withWriteLock<T>(fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
  const run = tail.then(async () => {
    const conn = await getConnection();
    try {
      return await fn(conn);
    } finally {
      conn.closeSync();
    }
  });
  // Keep the chain alive even if a write rejects.
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
