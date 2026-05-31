import { listDatasets } from "../ingest/upload.js";

/**
 * Ensure a dataset view exists and exposes the required columns. Predefined
 * reports use this so identifiers in their SQL are a validated allowlist.
 */
export function requireView(viewName: string, requiredColumns: string[]): Set<string> {
  const ds = listDatasets().find((d) => d.name === viewName);
  if (!ds) {
    throw new Error(
      `Dataset "${viewName}" is not loaded. Upload it on the Datasets tab (view name "${viewName}").`,
    );
  }
  const cols = new Set(ds.columns.map((c) => c.name));
  const missing = requiredColumns.filter((c) => !cols.has(c));
  if (missing.length) {
    throw new Error(`Dataset "${viewName}" is missing columns: ${missing.join(", ")}.`);
  }
  return cols;
}
