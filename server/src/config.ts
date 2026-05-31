import { resolve } from "node:path";

/** Runtime configuration, overridable via environment variables. */
export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "0.0.0.0",
  /** Directory holding the DuckDB file, SQLite metadata DB, and staged uploads. */
  dataDir: resolve(process.env.DATA_DIR ?? "./data"),
  /** Where uploaded source files are stored before being exposed as DuckDB views. */
  stagingDir: resolve(process.env.STAGING_DIR ?? "./data/staging"),
  /** Max rows any single metric query may return. */
  maxRows: Number(process.env.MAX_ROWS ?? 50_000),
  /** Number of reusable DuckDB read connections. */
  readPoolSize: Number(process.env.READ_POOL_SIZE ?? 4),
  /** Per-query timeout in ms; the query is interrupted when exceeded (0 = disabled). */
  queryTimeoutMs: Number(process.env.QUERY_TIMEOUT_MS ?? 30_000),
  /** Allowed browser origin for the SPA during development. */
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
} as const;

export const duckdbPath = resolve(config.dataDir, "analytics.duckdb");
export const metadataPath = resolve(config.dataDir, "metadata.sqlite");
