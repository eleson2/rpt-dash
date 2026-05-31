import { z } from "zod";

/** Param value types a metric can declare; drives validation + DuckDB binding. */
export const paramTypeSchema = z.enum(["string", "number", "boolean", "date"]);
export type ParamType = z.infer<typeof paramTypeSchema>;

export const paramDefSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "param name must be a SQL identifier"),
  type: paramTypeSchema,
  required: z.boolean().default(true),
});
export type ParamDef = z.infer<typeof paramDefSchema>;

export const vizSchema = z.object({
  type: z.enum(["line", "bar", "table"]).default("table"),
  xField: z.string().optional(),
  yFields: z.array(z.string()).default([]),
});
export type Viz = z.infer<typeof vizSchema>;

export const metricInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  sql: z.string().min(1),
  params: z.array(paramDefSchema).default([]),
  viz: vizSchema.default({ type: "table", yFields: [] }),
});
export type MetricInput = z.infer<typeof metricInputSchema>;

export interface Metric extends MetricInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** Build a zod schema that validates runtime param values against a metric's declared params. */
export function paramValuesSchema(params: ParamDef[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of params) {
    let base: z.ZodTypeAny;
    switch (p.type) {
      case "number":
        base = z.coerce.number();
        break;
      case "boolean":
        base = z.coerce.boolean();
        break;
      case "date":
        base = z.coerce.date();
        break;
      default:
        base = z.string();
    }
    shape[p.name] = p.required ? base : base.optional();
  }
  return z.object(shape).strict();
}

/**
 * Defense-in-depth: metric SQL must be a single read-only statement.
 * The curated model means only admins author SQL, but we still reject
 * anything that could mutate data or chain statements.
 */
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|attach|copy|pragma|set|call|export|install|load)\b/i;

export function assertReadOnlySql(sql: string): void {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (trimmed.includes(";")) {
    throw new Error("Metric SQL must be a single statement (no ';').");
  }
  if (!/^(select|with)\b/i.test(trimmed)) {
    throw new Error("Metric SQL must start with SELECT or WITH.");
  }
  if (FORBIDDEN.test(trimmed)) {
    throw new Error("Metric SQL may not contain data-modifying or DDL keywords.");
  }
}
