import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { registerDataset, registerView, safeViewName } from "./upload.js";
import { parquetGlobReader } from "./introspect.js";

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
  /** Combined per-type views (e.g. SMF70) unioning all matching files. */
  combined: string[];
  errors: { path: string; error: string }[];
}

/**
 * Group key for combining files into one table: the filename prefix before the
 * first '-' (e.g. `SMF70-20250410-….parquet` → `SMF70`). Files without a '-'
 * group under their bare name. Returns the group name plus the glob (relative
 * to root) that matches every file in the group across all subdirectories.
 */
function groupFor(fileName: string): { type: string; pattern: string } {
  const base = fileName.replace(PARQUET_EXT, "");
  const dash = base.indexOf("-");
  if (dash > 0) {
    const type = base.slice(0, dash);
    return { type, pattern: `**/${type}-*.parquet` };
  }
  return { type: base, pattern: `**/${base}.parquet` };
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
  const combined: string[] = [];
  const errors: { path: string; error: string }[] = [];

  // One glob per type → the relative pattern used to build a combined view.
  const groups = new Map<string, string>();

  for await (const absPath of walkParquet(rootDir)) {
    const name = safeViewName(relative(rootDir, absPath));
    try {
      await registerDataset({ name, format: "parquet", absPath });
      registered.push(name);
    } catch (err) {
      errors.push({ path: absPath, error: (err as Error).message });
    }
    const { type, pattern } = groupFor(basename(absPath));
    groups.set(type, pattern);
  }

  // Combined views union every file of a type into one table (e.g. SMF70 across
  // all systems/months). Built from a glob, so they pick up new files on query.
  for (const [type, pattern] of groups) {
    const glob = join(rootDir, pattern);
    try {
      const ds = await registerView({
        name: type,
        reader: parquetGlobReader(glob),
        sourcePath: glob,
      });
      combined.push(ds.name);
    } catch (err) {
      errors.push({ path: glob, error: (err as Error).message });
    }
  }

  return { registered, combined, errors };
}
