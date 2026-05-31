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
