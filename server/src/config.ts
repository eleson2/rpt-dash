import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Optional JSON config file (default ./rpt-dash.config.json, override path via
 * CONFIG_FILE). Lets operators set things like the parquet root directory
 * without environment variables. Environment variables still take precedence.
 */
function loadConfigFile(): Record<string, unknown> {
  const path = resolve(process.env.CONFIG_FILE ?? "./rpt-dash.config.json");
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch (err) {
    throw new Error(`Failed to parse config file ${path}: ${(err as Error).message}`);
  }
}

const fileConfig = loadConfigFile();

/** Read a string setting: env var wins, then the config file, else undefined. */
function fileStr(key: string): string | undefined {
  const v = fileConfig[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

const parquetDir = process.env.PARQUET_DIR ?? fileStr("parquetDir");

/** Runtime configuration, overridable via environment variables. */
export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "0.0.0.0",
  /** Directory holding the DuckDB file, SQLite metadata DB, and staged uploads. */
  dataDir: resolve(process.env.DATA_DIR ?? "./data"),
  /** Where uploaded source files are stored before being exposed as DuckDB views. */
  stagingDir: resolve(process.env.STAGING_DIR ?? "./data/staging"),
  /**
   * Root directory of parquet files. Every *.parquet under it is auto-registered
   * as a dataset/view on startup (recursively), so end users never deal with
   * uploads or storage format. Unset = feature off. (config file: "parquetDir")
   */
  parquetDir: parquetDir ? resolve(parquetDir) : undefined,
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
