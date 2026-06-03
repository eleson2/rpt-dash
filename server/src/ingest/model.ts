import { meta } from "../db/metadata.js";
import { effectiveAlias, getCuration } from "./curation.js";
import type { ColumnInfo } from "./introspect.js";

/** Role a conformed join-key column plays when correlating datasets. */
export type KeyRole = "system" | "sysplex" | "time" | "interval" | "entity";
export const KEY_ROLES: KeyRole[] = ["system", "sysplex", "time", "interval", "entity"];

/** Coarse data-source groupings used to organise the picker. */
export const FAMILIES = ["CPU", "Workload", "Address space", "I/O", "Storage", "Other"];

export interface DatasetKey {
  /** Physical column name (stable across curation renames). */
  column: string;
  role: KeyRole;
  /** Exposed/labelled name for display; resolved from curation. */
  label?: string;
}

export interface DatasetModel {
  description: string | null;
  family: string | null;
  keys: DatasetKey[];
}

/**
 * Default family + one-line description per SMF record type. Used to seed a
 * dataset's model on first registration; admins can override afterwards. Keyed
 * by the combined-view name (which equals the record type).
 */
const RECORD_MODEL: Record<string, { family: string; description: string }> = {
  SMF30: { family: "Address space", description: "Address-space (job/step) accounting — CPU, EXCP, and elapsed time per job." },
  SMF70: { family: "CPU", description: "RMF CPU activity — processor utilisation per LPAR and CPC." },
  SMF71: { family: "Storage", description: "RMF paging activity — central/auxiliary storage and paging rates." },
  SMF72: { family: "Workload", description: "RMF workload activity — service/report-class consumption (WLM)." },
  SMF73: { family: "I/O", description: "RMF channel-path activity — channel utilisation." },
  SMF74: { family: "I/O", description: "RMF device activity — DASD/device I/O response and rates." },
  SMF75: { family: "Storage", description: "RMF page-dataset activity — page-dataset slot usage and I/O." },
  SMF76: { family: "Other", description: "RMF trace activity." },
  SMF77: { family: "Other", description: "RMF enqueue activity — enqueue contention." },
  SMF78: { family: "I/O", description: "RMF I/O queuing — I/O queuing and virtual storage." },
  SMF79: { family: "Other", description: "RMF Monitor II measurements." },
  SMF99: { family: "Workload", description: "WLM decisions/trace — service-class goal management." },
  SMF113: { family: "CPU", description: "Hardware instrumentation — CPU Measurement Facility counters." },
  RAW: { family: "Other", description: "Unparsed SMF records (raw body)." },
};

/** Physical columns that act as conformed join keys, and the role each plays. */
const CONFORMED_KEYS: { column: string; role: KeyRole }[] = [
  { column: "system_id", role: "system" },
  { column: "sysplex_name", role: "sysplex" },
  { column: "interval_start_ts", role: "interval" },
  { column: "smf_timestamp", role: "time" },
];

interface KeyRow {
  column: string;
  role: KeyRole;
}

/** Map each physical column to the name it's exposed under (after curation). */
function exposedNames(dataset: string): Map<string, string> {
  return new Map(getCuration(dataset).map((m) => [m.column, effectiveAlias(m)]));
}

export function getDatasetModel(dataset: string): DatasetModel {
  const row = meta
    .prepare("SELECT description, family FROM datasets WHERE name = ?")
    .get(dataset) as { description: string | null; family: string | null } | undefined;
  const keyRows = meta
    .prepare("SELECT column, role FROM dataset_keys WHERE dataset = ? ORDER BY column")
    .all(dataset) as KeyRow[];
  const labels = exposedNames(dataset);
  return {
    description: row?.description ?? null,
    family: row?.family ?? null,
    keys: keyRows.map((k) => ({ column: k.column, role: k.role, label: labels.get(k.column) ?? k.column })),
  };
}

/** Replace a dataset's description, family, and conformed keys. */
export function setDatasetModel(
  dataset: string,
  model: { description: string | null; family: string | null; keys: KeyRow[] },
): void {
  const tx = meta.transaction(() => {
    meta
      .prepare("UPDATE datasets SET description = @description, family = @family WHERE name = @dataset")
      .run({
        dataset,
        description: model.description?.trim() ? model.description.trim() : null,
        family: model.family?.trim() ? model.family.trim() : null,
      });
    meta.prepare("DELETE FROM dataset_keys WHERE dataset = ?").run(dataset);
    const insert = meta.prepare(
      "INSERT INTO dataset_keys (dataset, column, role) VALUES (@dataset, @column, @role)",
    );
    for (const k of model.keys) insert.run({ dataset, column: k.column, role: k.role });
  });
  tx();
}

/**
 * Fill in a dataset's model defaults without overwriting admin edits: set
 * family/description from the record-type map when both are blank, and seed
 * conformed keys from the physical columns when none are recorded yet.
 */
export function seedDatasetDefaults(dataset: string, physicalColumns: ColumnInfo[]): void {
  const row = meta
    .prepare("SELECT description, family FROM datasets WHERE name = ?")
    .get(dataset) as { description: string | null; family: string | null } | undefined;

  if (row && row.description == null && row.family == null) {
    const def = RECORD_MODEL[dataset] ?? { family: "Other", description: null };
    meta
      .prepare("UPDATE datasets SET description = @description, family = @family WHERE name = @dataset")
      .run({ dataset, description: def.description, family: def.family });
  }

  const keyCount = (
    meta.prepare("SELECT count(*) AS n FROM dataset_keys WHERE dataset = ?").get(dataset) as { n: number }
  ).n;
  if (keyCount === 0) {
    const present = new Set(physicalColumns.map((c) => c.name));
    const insert = meta.prepare(
      "INSERT INTO dataset_keys (dataset, column, role) VALUES (@dataset, @column, @role)",
    );
    for (const k of CONFORMED_KEYS) {
      if (present.has(k.column)) insert.run({ dataset, column: k.column, role: k.role });
    }
  }
}
