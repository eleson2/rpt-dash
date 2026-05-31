/** A UI control for a predefined report; `optionsKey` references options() output. */
export type Control =
  | { name: string; label: string; type: "single"; optionsKey: string; required?: boolean }
  | { name: string; label: string; type: "multi"; optionsKey: string }
  | { name: string; label: string; type: "date"; defaultKey?: string };

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

export interface PredefinedReport {
  id: string;
  title: string;
  description: string;
  chart: ReportOutput["chart"];
  controls: Control[];
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
}

export function toMeta(r: PredefinedReport): ReportMeta {
  return { id: r.id, title: r.title, description: r.description, chart: r.chart, controls: r.controls };
}
