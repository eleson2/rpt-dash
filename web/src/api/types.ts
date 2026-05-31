export type ParamType = "string" | "number" | "boolean" | "date";

export interface ParamDef {
  name: string;
  type: ParamType;
  required: boolean;
}

export interface Viz {
  type: "line" | "bar" | "table";
  xField?: string;
  yFields: string[];
}

export interface Metric {
  id: string;
  name: string;
  description?: string;
  sql: string;
  params: ParamDef[];
  viz: Viz;
  createdAt: string;
  updatedAt: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface Dataset {
  id: string;
  name: string;
  sourcePath: string;
  format: "parquet" | "csv" | "json";
  columns: ColumnInfo[];
  rowEstimate: number;
  createdAt: string;
}

export interface RunResult {
  metricId: string;
  truncated: boolean;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface MetricInput {
  name: string;
  description?: string;
  sql: string;
  params: ParamDef[];
  viz: Viz;
}

export interface PreviewResult {
  truncated: boolean;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface DashboardTile {
  metricId: string;
  w: number;
  h: number;
}

export interface Dashboard {
  id: string;
  name: string;
  layout: DashboardTile[];
  createdAt: string;
  updatedAt: string;
}

export interface DashboardInput {
  name: string;
  layout: DashboardTile[];
}

export type Transform = "none" | "year" | "month" | "day";
export type Agg = "count" | "sum" | "avg" | "min" | "max";
export type FilterOp = "=" | "!=" | ">" | ">=" | "<" | "<=" | "in" | "contains";

export interface Dimension {
  column: string;
  transform: Transform;
}
export interface Measure {
  agg: Agg;
  column?: string;
}
export interface ReportFilter {
  column: string;
  op: FilterOp;
  value: string | number | boolean | (string | number)[];
}
export interface ReportSpec {
  dataset: string;
  dimensions: Dimension[];
  measures: Measure[];
  filters: ReportFilter[];
  orderBy?: { ref: string; dir: "asc" | "desc" };
  limit?: number;
  viz: Viz;
}

export type PredefinedControl =
  | { name: string; label: string; type: "single"; optionsKey: string; required?: boolean }
  | { name: string; label: string; type: "multi"; optionsKey: string }
  | { name: string; label: string; type: "date"; defaultKey?: string };

export interface PredefinedReportMeta {
  id: string;
  title: string;
  description: string;
  chart: "stacked-area" | "line" | "bar";
  controls: PredefinedControl[];
}

export interface ReportOptions {
  [key: string]: unknown;
}

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

export type Role = "admin" | "viewer";

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
}

export interface AuthState {
  user: AuthUser | null;
  needsBootstrap: boolean;
}
