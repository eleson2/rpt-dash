import { meta } from "../db/metadata.js";
import type { ColumnInfo } from "./introspect.js";

/** Per-column curation for a dataset view: friendly label + visibility + order. */
export interface ColumnMeta {
  column: string;
  /** Friendly alias; null/undefined means use the physical column name. */
  label: string | null;
  visible: boolean;
  sortOrder: number | null;
}

interface ColumnMetaRow {
  column: string;
  label: string | null;
  visible: number;
  sort_order: number | null;
}

/** Quote a DuckDB identifier. Aliases may contain spaces, so always quote. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** The effective alias a column is exposed under (label if set, else physical). */
export function effectiveAlias(m: { column: string; label: string | null }): string {
  const label = m.label?.trim();
  return label && label.length > 0 ? label : m.column;
}

export function getCuration(dataset: string): ColumnMeta[] {
  const rows = meta
    .prepare(
      `SELECT column, label, visible, sort_order
         FROM column_meta WHERE dataset = ? ORDER BY sort_order, column`,
    )
    .all(dataset) as ColumnMetaRow[];
  return rows.map((r) => ({
    column: r.column,
    label: r.label,
    visible: r.visible !== 0,
    sortOrder: r.sort_order,
  }));
}

/**
 * Replace the curation for a dataset with `entries`. Validates that aliases are
 * non-empty, unique, and that at least one column stays visible. Does not touch
 * the DuckDB view — callers rebuild the view afterwards (see upload.ts).
 */
export function setCuration(dataset: string, entries: ColumnMeta[]): void {
  validateCuration(entries);
  const tx = meta.transaction((rows: ColumnMeta[]) => {
    meta.prepare("DELETE FROM column_meta WHERE dataset = ?").run(dataset);
    const insert = meta.prepare(
      `INSERT INTO column_meta (dataset, column, label, visible, sort_order)
       VALUES (@dataset, @column, @label, @visible, @sort_order)`,
    );
    rows.forEach((m, i) => {
      insert.run({
        dataset,
        column: m.column,
        label: m.label?.trim() ? m.label.trim() : null,
        visible: m.visible ? 1 : 0,
        sort_order: m.sortOrder ?? i,
      });
    });
  });
  tx(entries);
}

/** Throw if a curation set is internally inconsistent. */
export function validateCuration(entries: ColumnMeta[]): void {
  const visible = entries.filter((e) => e.visible);
  if (entries.length > 0 && visible.length === 0) {
    throw new Error("At least one column must stay visible.");
  }
  const aliases = new Map<string, string>();
  for (const e of visible) {
    const alias = effectiveAlias(e);
    if (!alias) throw new Error(`Column "${e.column}" has an empty label.`);
    const prev = aliases.get(alias);
    if (prev) {
      throw new Error(
        `Duplicate column name "${alias}" (from "${prev}" and "${e.column}"). Labels must be unique.`,
      );
    }
    aliases.set(alias, e.column);
  }
}

/**
 * Resolve a dataset's physical columns through its curation: the visible
 * columns in display order, each with its physical name, exposed alias, and
 * type. Columns with no curation row default to visible with alias = physical
 * name, so an uncurated dataset resolves to its physical schema unchanged.
 */
function resolveColumns(
  dataset: string,
  physicalColumns: ColumnInfo[],
): { column: string; alias: string; type: string }[] {
  const curation = new Map(getCuration(dataset).map((m) => [m.column, m]));
  return physicalColumns
    .map((c, i) => {
      const m = curation.get(c.name);
      return {
        column: c.name,
        type: c.type,
        label: m?.label ?? null,
        visible: m ? m.visible : true,
        sortOrder: m?.sortOrder ?? i,
      };
    })
    .filter((c) => c.visible)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((c) => ({ column: c.column, alias: effectiveAlias(c), type: c.type }));
}

/**
 * Build the SELECT list that materializes a dataset's curation:
 * `"phys" AS "alias"` for each visible physical column. An uncurated dataset
 * yields an identity projection equivalent to `SELECT *`.
 */
export function buildSelectList(dataset: string, physicalColumns: ColumnInfo[]): string {
  const resolved = resolveColumns(dataset, physicalColumns);
  if (resolved.length === 0) {
    // Defensive: never emit an empty projection. setCuration enforces at least
    // one visible column, so this only guards a fully-hidden uncurated edge.
    return "*";
  }
  return resolved
    .map((c) =>
      c.alias === c.column ? quoteIdent(c.column) : `${quoteIdent(c.column)} AS ${quoteIdent(c.alias)}`,
    )
    .join(", ");
}

/**
 * The columns a curated view exposes to consumers (alias as name, physical
 * type), matching `buildSelectList`. Stored as the dataset's `columns` so the
 * report builder and predefined catalog see the curated schema.
 */
export function curatedColumns(dataset: string, physicalColumns: ColumnInfo[]): ColumnInfo[] {
  const resolved = resolveColumns(dataset, physicalColumns);
  if (resolved.length === 0) return physicalColumns;
  return resolved.map((c) => ({ name: c.alias, type: c.type }));
}
