import { listMetrics, updateVisualMetricSpec } from "../metrics/store.js";
import { buildReportSql } from "./build.js";
import type { ReportSpec } from "./types.js";

export interface MigrationResult {
  /** Names of visual reports re-baked against the new schema. */
  migrated: string[];
  /** Names of visual reports that could no longer be built (e.g. a column they
   *  referenced was hidden), left unchanged for the admin to fix. */
  warnings: string[];
}

/** Apply a column-rename map to every column reference in a report spec. */
function renameSpec(spec: ReportSpec, renames: Map<string, string>): ReportSpec {
  const r = (col: string) => renames.get(col) ?? col;
  return {
    ...spec,
    dimensions: spec.dimensions.map((d) => ({ ...d, column: r(d.column) })),
    measures: spec.measures.map((m) => (m.column ? { ...m, column: r(m.column) } : m)),
    filters: spec.filters.map((f) => ({ ...f, column: r(f.column) })),
    orderBy: spec.orderBy ? { ...spec.orderBy, ref: r(spec.orderBy.ref) } : undefined,
  };
}

/**
 * Re-bake saved visual reports after a dataset's columns were re-curated.
 * Applies `renames` (old exposed name → new exposed name) and rebuilds each
 * report's SQL against the now-current catalog. Reports that can no longer be
 * built (e.g. they referenced a column that was hidden) are reported as
 * warnings and left untouched rather than failing the whole curation save.
 */
export function migrateVisualReports(dataset: string, renames: Map<string, string>): MigrationResult {
  const migrated: string[] = [];
  const warnings: string[] = [];

  for (const metric of listMetrics()) {
    if (metric.kind !== "visual" || !metric.spec) continue;
    const spec = metric.spec as ReportSpec;
    if (spec.dataset !== dataset) continue;

    const next = renameSpec(spec, renames);
    try {
      const built = buildReportSql(next);
      updateVisualMetricSpec(metric.id, {
        sql: built.sql,
        viz: built.viz,
        fixedParams: built.params,
        spec: next,
      });
      migrated.push(metric.name);
    } catch {
      warnings.push(metric.name);
    }
  }

  return { migrated, warnings };
}
