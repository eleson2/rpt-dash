import { z } from "zod";
import { vizSchema } from "../metrics/types.js";

/** Date bucketing applied to a dimension column. */
export const transformSchema = z.enum(["none", "year", "month", "day"]);
export type Transform = z.infer<typeof transformSchema>;

export const aggSchema = z.enum(["count", "sum", "avg", "min", "max"]);
export type Agg = z.infer<typeof aggSchema>;

export const filterOpSchema = z.enum(["=", "!=", ">", ">=", "<", "<=", "in", "contains"]);
export type FilterOp = z.infer<typeof filterOpSchema>;

export const dimensionSchema = z.object({
  column: z.string().min(1),
  transform: transformSchema.default("none"),
});
export type Dimension = z.infer<typeof dimensionSchema>;

export const measureSchema = z.object({
  agg: aggSchema,
  // count may omit a column (COUNT(*)); other aggregations require one.
  column: z.string().optional(),
});
export type Measure = z.infer<typeof measureSchema>;

export const filterSchema = z.object({
  column: z.string().min(1),
  op: filterOpSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
});
export type Filter = z.infer<typeof filterSchema>;

export const reportSpecSchema = z
  .object({
    dataset: z.string().min(1),
    dimensions: z.array(dimensionSchema).default([]),
    measures: z.array(measureSchema).min(1, "add at least one measure"),
    filters: z.array(filterSchema).default([]),
    orderBy: z
      .object({ ref: z.string(), dir: z.enum(["asc", "desc"]).default("asc") })
      .optional(),
    limit: z.number().int().positive().optional(),
    viz: vizSchema.default({ type: "bar", yFields: [] }),
  })
  .strict();
export type ReportSpec = z.infer<typeof reportSpecSchema>;

export const reportInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  spec: reportSpecSchema,
});
export type ReportInput = z.infer<typeof reportInputSchema>;
