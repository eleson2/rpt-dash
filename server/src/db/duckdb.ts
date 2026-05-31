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

/**
 * Bounded pool of reusable read connections. DuckDB connections must not be
 * driven concurrently, so each in-flight query holds its own connection; the
 * pool caps how many run at once and reuses connections across requests.
 */
class ReadPool {
  private idle: DuckDBConnection[] = [];
  private waiters: ((conn: DuckDBConnection) => void)[] = [];
  private size = 0;

  constructor(private readonly max: number) {}

  async acquire(): Promise<DuckDBConnection> {
    const existing = this.idle.pop();
    if (existing) return existing;
    if (this.size < this.max) {
      this.size++;
      return getConnection();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(conn: DuckDBConnection): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(conn);
    else this.idle.push(conn);
  }

  /** Drop a connection that may be in a bad state (e.g. after an interrupt). */
  discard(conn: DuckDBConnection): void {
    try {
      conn.closeSync();
    } catch {
      // ignore
    }
    this.size--;
    // Make room for a waiter by minting a replacement connection.
    const waiter = this.waiters.shift();
    if (waiter) {
      this.size++;
      void getConnection().then(waiter);
    }
  }
}

let readPool: ReadPool | null = null;
function pool(): ReadPool {
  if (!readPool) readPool = new ReadPool(Math.max(1, config.readPoolSize));
  return readPool;
}

/**
 * Run a SELECT with optional named ($name) parameters and return JSON-safe rows.
 * Enforces a per-query timeout by interrupting the connection when exceeded.
 */
export async function runQuery(
  sql: string,
  params?: Record<string, unknown>,
  timeoutMs: number = config.queryTimeoutMs,
): Promise<QueryResult> {
  const conn = await pool().acquire();
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  try {
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          conn.interrupt();
        } catch {
          // ignore
        }
      }, timeoutMs);
    }
    const reader = params
      ? await conn.runAndReadAll(sql, toDuckValues(params))
      : await conn.runAndReadAll(sql);
    clearTimeout(timer);
    pool().release(conn);
    return {
      columns: reader.columnNames(),
      // getRowObjectsJson() yields JSON-serializable values (no bigint/temporal objects).
      rows: reader.getRowObjectsJson() as unknown as Record<string, unknown>[],
    };
  } catch (err) {
    clearTimeout(timer);
    // An interrupted connection may be left mid-statement; discard it.
    pool().discard(conn);
    if (timedOut) throw new Error(`Query exceeded ${timeoutMs}ms timeout`);
    throw err;
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
