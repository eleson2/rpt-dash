/** A UI control for a predefined report; `optionsKey` references options() output. */
export type Control =
  | { name: string; label: string; type: "single"; optionsKey: string; required?: boolean; default?: string }
  | { name: string; label: string; type: "multi"; optionsKey: string }
  | { name: string; label: string; type: "date"; defaultKey?: string }
  | { name: string; label: string; type: "datetime"; defaultKey?: string };

export interface StackedSeries {
  name: string;
  data: number[];
}

export interface ReportOutput {
  chart: "stacked-area" | "line" | "bar";
  categories: string[];
  series: StackedSeries[];
  unit?: string;
}

/**
 * Declarative time-hierarchy descriptor. When present, the chart becomes
 * drillable: clicking a time bucket re-runs the report narrowed to that bucket
 * at the next finer granularity. Purely metadata — drilling reuses run().
 */
export interface DrilldownSpec {
  fromParam: string; // control name holding the lower time bound
  toParam: string; // control name holding the upper time bound
  granularityParam: string; // control name holding the bucket width
  // Ordered COARSE → FINE; `value` matches a granularity option, bucketMs = bucket width.
  ladder: { value: string; bucketMs: number }[];
}

export interface PredefinedReport {
  id: string;
  title: string;
  description: string;
  chart: ReportOutput["chart"];
  controls: Control[];
  /**
   * The dataset view this report reads, and the physical columns it depends on.
   * Declared so column-curation can refuse to rename/hide a column a predefined
   * report needs (it references columns by physical name in its SQL).
   */
  view?: string;
  requiredColumns?: string[];
  /** Optional time-drilldown descriptor; omit for non-drillable reports. */
  drilldown?: DrilldownSpec;
  /** Dynamic option lists keyed by control.optionsKey (e.g. lpars, serviceClasses, minDate). */
  options(): Promise<Record<string, unknown>>;
  /** Validate params, build safe SQL, return chart-ready data. */
  run(rawParams: unknown): Promise<ReportOutput>;
}

/** Metadata view of a report (no functions) for the listing endpoint. */
export interface ReportMeta {
  id: string;
  title: string;
  description: string;
  chart: ReportOutput["chart"];
  controls: Control[];
  drilldown?: DrilldownSpec;
}

export function toMeta(r: PredefinedReport): ReportMeta {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    chart: r.chart,
    controls: r.controls,
    drilldown: r.drilldown,
  };
}
