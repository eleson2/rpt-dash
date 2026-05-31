import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { registerDataset, safeViewName } from "./upload.js";

const PARQUET_EXT = /\.(parquet|pq)$/i;

/** Recursively yield absolute paths of parquet files under `dir`. */
async function* walkParquet(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable/missing directory → nothing to yield
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walkParquet(full);
    else if (e.isFile() && PARQUET_EXT.test(e.name)) yield full;
  }
}

export interface DiscoverResult {
  registered: string[];
  errors: { path: string; error: string }[];
}

/**
 * Scan `rootDir` recursively and register every parquet file as a DuckDB
 * view/dataset. The view name is derived from the file's path relative to the
 * root (so nested files don't collide), sanitized to a safe identifier:
 * `region/cpu.parquet` → `region_cpu`. Idempotent — re-running updates existing
 * datasets in place (registerDataset upserts on name).
 */
export async function discoverParquet(rootDir: string): Promise<DiscoverResult> {
  const registered: string[] = [];
  const errors: { path: string; error: string }[] = [];
  for await (const absPath of walkParquet(rootDir)) {
    const name = safeViewName(relative(rootDir, absPath));
    try {
      await registerDataset({ name, format: "parquet", absPath });
      registered.push(name);
    } catch (err) {
      errors.push({ path: absPath, error: (err as Error).message });
    }
  }
  return { registered, errors };
}
