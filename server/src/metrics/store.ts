import { nanoid } from "nanoid";
import { meta } from "../db/metadata.js";
import {
  type Metric,
  type MetricInput,
  assertReadOnlySql,
  metricInputSchema,
} from "./types.js";

interface MetricRow {
  id: string;
  name: string;
  description: string | null;
  sql: string;
  params: string;
  viz: string;
  kind: "sql" | "visual";
  spec: string | null;
  owner_id: string | null;
  fixed_params: string | null;
  created_at: string;
  updated_at: string;
}

function rowToMetric(r: MetricRow): Metric {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    sql: r.sql,
    params: JSON.parse(r.params),
    viz: JSON.parse(r.viz),
    kind: r.kind ?? "sql",
    spec: r.spec ? JSON.parse(r.spec) : null,
    fixedParams: r.fixed_params ? JSON.parse(r.fixed_params) : {},
    ownerId: r.owner_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Extra fields for visual reports stored as metrics. */
export interface MetricExtras {
  kind?: "sql" | "visual";
  spec?: unknown;
  fixedParams?: Record<string, unknown>;
  ownerId?: string | null;
}

export function listMetrics(): Metric[] {
  const rows = meta.prepare("SELECT * FROM metrics ORDER BY name").all() as MetricRow[];
  return rows.map(rowToMetric);
}

export function getMetric(id: string): Metric | undefined {
  const row = meta.prepare("SELECT * FROM metrics WHERE id = ?").get(id) as MetricRow | undefined;
  return row ? rowToMetric(row) : undefined;
}

export function createMetric(input: MetricInput, extras: MetricExtras = {}): Metric {
  const parsed = metricInputSchema.parse(input);
  assertReadOnlySql(parsed.sql);
  const id = nanoid(12);
  meta
    .prepare(
      `INSERT INTO metrics (id, name, description, sql, params, viz, kind, spec, owner_id, fixed_params)
       VALUES (@id, @name, @description, @sql, @params, @viz, @kind, @spec, @owner_id, @fixed_params)`,
    )
    .run({
      id,
      name: parsed.name,
      description: parsed.description ?? null,
      sql: parsed.sql,
      params: JSON.stringify(parsed.params),
      viz: JSON.stringify(parsed.viz),
      kind: extras.kind ?? "sql",
      spec: extras.spec ? JSON.stringify(extras.spec) : null,
      owner_id: extras.ownerId ?? null,
      fixed_params: JSON.stringify(extras.fixedParams ?? {}),
    });
  return getMetric(id)!;
}

export function updateMetric(id: string, input: MetricInput): Metric | undefined {
  const parsed = metricInputSchema.parse(input);
  assertReadOnlySql(parsed.sql);
  const res = meta
    .prepare(
      `UPDATE metrics
         SET name = @name, description = @description, sql = @sql,
             params = @params, viz = @viz, updated_at = datetime('now')
       WHERE id = @id`,
    )
    .run({
      id,
      name: parsed.name,
      description: parsed.description ?? null,
      sql: parsed.sql,
      params: JSON.stringify(parsed.params),
      viz: JSON.stringify(parsed.viz),
    });
  return res.changes ? getMetric(id) : undefined;
}

export function deleteMetric(id: string): boolean {
  return meta.prepare("DELETE FROM metrics WHERE id = ?").run(id).changes > 0;
}
