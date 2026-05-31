import { z } from "zod";
import { config } from "../config.js";
import { runQuery } from "../db/duckdb.js";
import { requireView } from "./catalog.js";
import type { PredefinedReport, ReportOutput, StackedSeries } from "./types.js";

// Expected schema of the source view (override the view name via env).
const VIEW = process.env.CPU_VIEW ?? "cpu_by_service_class";
const COL = { ts: "ts", lpar: "lpar", serviceClass: "service_class", cpu: "cpu" };

const OTHER = "Other";

// Allowed time-bucket widths (server-side allowlist → safe to inline as an
// INTERVAL literal; never user free-text). Keys are also the UI labels.
const GRANULARITIES = {
  "1 minute": "1 minute",
  "5 minutes": "5 minutes",
  "15 minutes": "15 minutes",
  "1 hour": "1 hour",
  "1 day": "1 day",
} as const;
type Granularity = keyof typeof GRANULARITIES;
const GRANULARITY_KEYS = Object.keys(GRANULARITIES) as [Granularity, ...Granularity[]];
const DEFAULT_GRANULARITY: Granularity = "1 hour";

const paramsSchema = z.object({
  lpar: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  granularity: z.enum(GRANULARITY_KEYS).default(DEFAULT_GRANULARITY),
  // Service classes to show individually; the rest are summed into "Other".
  serviceClasses: z.array(z.string()).default([]),
});

/**
 * Normalize a date/datetime bound for DuckDB. Accepts a bare date
 * (YYYY-MM-DD), which is widened to the start/end of that day, or a datetime
 * (with a "T" or space separator, minute precision), which is used as-is.
 */
function normalizeBound(v: string, isEnd: boolean): string {
  const s = v.replace("T", " ").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isEnd ? `${s} 23:59:59` : `${s} 00:00:00`;
  return s;
}

/** Long-form rows {t, series, v} → stacked categories + series, "Other" on top. */
export function pivot(
  rows: Record<string, unknown>[],
  selectedOrder: string[],
): { categories: string[]; series: StackedSeries[] } {
  const byT = new Map<string, Record<string, number>>();
  const present = new Set<string>();
  for (const r of rows) {
    const t = String(r.t);
    const s = String(r.series);
    present.add(s);
    const bucket = byT.get(t) ?? {};
    bucket[s] = (bucket[s] ?? 0) + Number(r.v ?? 0);
    byT.set(t, bucket);
  }
  const categories = [...byT.keys()].sort();
  // Selected classes (in chosen order) first, then "Other" so it stacks on top.
  const order = [
    ...selectedOrder.filter((s) => present.has(s)),
    ...(present.has(OTHER) ? [OTHER] : []),
  ];
  const series = order.map((name) => ({
    name,
    data: categories.map((t) => byT.get(t)?.[name] ?? 0),
  }));
  return { categories, series };
}

export const cpuByServiceClass: PredefinedReport = {
  id: "cpu-by-service-class",
  title: "CPU usage per service class",
  description:
    "Stacked CPU usage over time for one LPAR. Pick which service classes to show individually; the rest are summed into an 'Other' band on top.",
  chart: "stacked-area",
  controls: [
    { name: "lpar", label: "LPAR", type: "single", optionsKey: "lpars", required: true },
    { name: "from", label: "From", type: "datetime", defaultKey: "minTs" },
    { name: "to", label: "To", type: "datetime", defaultKey: "maxTs" },
    { name: "granularity", label: "Granularity", type: "single", optionsKey: "granularities", default: DEFAULT_GRANULARITY },
    { name: "serviceClasses", label: "Service classes (shown individually)", type: "multi", optionsKey: "serviceClasses" },
  ],
  // Time hierarchy (coarse → fine); `value`s mirror GRANULARITIES so the ladder
  // and the Granularity dropdown agree.
  drilldown: {
    fromParam: "from",
    toParam: "to",
    granularityParam: "granularity",
    ladder: [
      { value: "1 day", bucketMs: 86_400_000 },
      { value: "1 hour", bucketMs: 3_600_000 },
      { value: "15 minutes", bucketMs: 900_000 },
      { value: "5 minutes", bucketMs: 300_000 },
      { value: "1 minute", bucketMs: 60_000 },
    ],
  },

  async options() {
    requireView(VIEW, Object.values(COL));
    const q = (sql: string) => runQuery(sql);
    const lpars = (await q(`SELECT DISTINCT "${COL.lpar}" AS v FROM "${VIEW}" ORDER BY 1`)).rows.map(
      (r) => String(r.v),
    );
    const serviceClasses = (
      await q(`SELECT DISTINCT "${COL.serviceClass}" AS v FROM "${VIEW}" ORDER BY 1`)
    ).rows.map((r) => String(r.v));
    const range = (
      await q(
        `SELECT min(CAST("${COL.ts}" AS TIMESTAMP)) AS lo,
                max(CAST("${COL.ts}" AS TIMESTAMP)) AS hi
         FROM "${VIEW}"`,
      )
    ).rows[0];
    return {
      lpars,
      serviceClasses,
      granularities: Object.keys(GRANULARITIES),
      minTs: range?.lo ?? null,
      maxTs: range?.hi ?? null,
    };
  },

  async run(rawParams): Promise<ReportOutput> {
    requireView(VIEW, Object.values(COL));
    const p = paramsSchema.parse(rawParams);

    // Bind every literal as a parameter; identifiers come from the fixed COL map.
    const params: Record<string, unknown> = {
      lpar: p.lpar,
      from: normalizeBound(p.from, false),
      to: normalizeBound(p.to, true),
    };

    // Bucketing expression: selected classes map to themselves, others to 'Other'.
    let seriesExpr: string;
    if (p.serviceClasses.length === 0) {
      seriesExpr = `'${OTHER}'`;
    } else {
      const keys = p.serviceClasses.map((sc, i) => {
        params[`s${i}`] = sc;
        return `$s${i}`;
      });
      seriesExpr = `CASE WHEN "${COL.serviceClass}" IN (${keys.join(", ")}) THEN "${COL.serviceClass}" ELSE '${OTHER}' END`;
    }

    // Bucket width is from the server-side allowlist, so inlining the INTERVAL
    // literal is safe. Value is the average over the bucket: total CPU divided
    // by the number of distinct source timestamps it covers. This equals the
    // raw value when the bucket matches the sample resolution, and correctly
    // averages (rather than sums) when down-sampling to a coarser granularity —
    // for both individual classes and the summed "Other" band.
    const interval = GRANULARITIES[p.granularity];
    const bucket = `time_bucket(INTERVAL '${interval}', CAST("${COL.ts}" AS TIMESTAMP))`;

    const sql = `
      SELECT ${bucket} AS t,
             ${seriesExpr} AS series,
             sum(CAST("${COL.cpu}" AS DOUBLE))
               / count(DISTINCT CAST("${COL.ts}" AS TIMESTAMP)) AS v
      FROM "${VIEW}"
      WHERE "${COL.lpar}" = $lpar
        AND CAST("${COL.ts}" AS TIMESTAMP) >= $from
        AND CAST("${COL.ts}" AS TIMESTAMP) <= $to
      GROUP BY 1, 2
      ORDER BY 1
      LIMIT ${config.maxRows}
    `;

    const result = await runQuery(sql, params);
    const { categories, series } = pivot(result.rows, p.serviceClasses);
    return { chart: "stacked-area", categories, series, unit: "CPU" };
  },
};
