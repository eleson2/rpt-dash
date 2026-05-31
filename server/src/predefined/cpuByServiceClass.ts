import { z } from "zod";
import { config } from "../config.js";
import { runQuery } from "../db/duckdb.js";
import { requireView } from "./catalog.js";
import type { PredefinedReport, ReportOutput, StackedSeries } from "./types.js";

// Expected schema of the source view (override the view name via env).
const VIEW = process.env.CPU_VIEW ?? "cpu_by_service_class";
const COL = { ts: "ts", lpar: "lpar", serviceClass: "service_class", cpu: "cpu" };

const OTHER = "Other";

const paramsSchema = z.object({
  lpar: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  // Service classes to show individually; the rest are summed into "Other".
  serviceClasses: z.array(z.string()).default([]),
});

/** A bare date (YYYY-MM-DD) is widened to cover the whole day. */
function startOfDay(v: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v} 00:00:00` : v;
}
function endOfDay(v: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v} 23:59:59` : v;
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
    { name: "from", label: "From", type: "date", defaultKey: "minDate" },
    { name: "to", label: "To", type: "date", defaultKey: "maxDate" },
    { name: "serviceClasses", label: "Service classes (shown individually)", type: "multi", optionsKey: "serviceClasses" },
  ],

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
        `SELECT min(CAST("${COL.ts}" AS DATE)) AS lo, max(CAST("${COL.ts}" AS DATE)) AS hi FROM "${VIEW}"`,
      )
    ).rows[0];
    return {
      lpars,
      serviceClasses,
      minDate: range?.lo ?? null,
      maxDate: range?.hi ?? null,
    };
  },

  async run(rawParams): Promise<ReportOutput> {
    requireView(VIEW, Object.values(COL));
    const p = paramsSchema.parse(rawParams);

    // Bind every literal as a parameter; identifiers come from the fixed COL map.
    const params: Record<string, unknown> = {
      lpar: p.lpar,
      from: startOfDay(p.from),
      to: endOfDay(p.to),
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

    const sql = `
      SELECT CAST("${COL.ts}" AS TIMESTAMP) AS t,
             ${seriesExpr} AS series,
             sum(CAST("${COL.cpu}" AS DOUBLE)) AS v
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
