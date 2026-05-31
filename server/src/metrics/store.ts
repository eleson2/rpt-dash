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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listMetrics(): Metric[] {
  const rows = meta.prepare("SELECT * FROM metrics ORDER BY name").all() as MetricRow[];
  return rows.map(rowToMetric);
}

export function getMetric(id: string): Metric | undefined {
  const row = meta.prepare("SELECT * FROM metrics WHERE id = ?").get(id) as MetricRow | undefined;
  return row ? rowToMetric(row) : undefined;
}

export function createMetric(input: MetricInput): Metric {
  const parsed = metricInputSchema.parse(input);
  assertReadOnlySql(parsed.sql);
  const id = nanoid(12);
  meta
    .prepare(
      `INSERT INTO metrics (id, name, description, sql, params, viz)
       VALUES (@id, @name, @description, @sql, @params, @viz)`,
    )
    .run({
      id,
      name: parsed.name,
      description: parsed.description ?? null,
      sql: parsed.sql,
      params: JSON.stringify(parsed.params),
      viz: JSON.stringify(parsed.viz),
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
