import type {
  AuthState,
  AuthUser,
  ColumnMeta,
  CurationResult,
  Dashboard,
  DashboardInput,
  Dataset,
  DatasetColumns,
  Metric,
  MetricInput,
  ParamDef,
  PredefinedReportMeta,
  PreviewResult,
  ReportOptions,
  ReportOutput,
  ReportSpec,
  RunResult,
  Viz,
} from "./types";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    // Send the session cookie (same-origin in dev via the Vite proxy).
    credentials: "include",
    headers: init?.body && !(init.body instanceof FormData)
      ? { "Content-Type": "application/json" }
      : undefined,
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  listDatasets: () => http<{ datasets: Dataset[] }>("/api/datasets").then((r) => r.datasets),

  uploadDataset: (file: File, name?: string) => {
    const form = new FormData();
    if (name) form.append("name", name);
    form.append("file", file);
    return http<{ dataset: Dataset }>("/api/datasets/upload", {
      method: "POST",
      body: form,
    }).then((r) => r.dataset);
  },

  getDatasetColumns: (name: string) =>
    http<DatasetColumns>(`/api/datasets/${encodeURIComponent(name)}/columns`),

  saveDatasetColumns: (name: string, columns: ColumnMeta[]) =>
    http<CurationResult>(`/api/datasets/${encodeURIComponent(name)}/columns`, {
      method: "PUT",
      body: JSON.stringify({ columns }),
    }),

  listMetrics: () => http<{ metrics: Metric[] }>("/api/metrics").then((r) => r.metrics),

  createMetric: (input: MetricInput) =>
    http<Metric>("/api/metrics", { method: "POST", body: JSON.stringify(input) }),

  deleteMetric: (id: string) => http<void>(`/api/metrics/${id}`, { method: "DELETE" }),

  runMetric: (id: string, params: Record<string, unknown>) =>
    http<RunResult>(`/api/metrics/${id}/run`, {
      method: "POST",
      body: JSON.stringify({ params }),
    }),

  previewMetric: (input: { sql: string; params: ParamDef[]; values: Record<string, unknown> }) =>
    http<PreviewResult>("/api/metrics/preview", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  listDashboards: () =>
    http<{ dashboards: Dashboard[] }>("/api/dashboards").then((r) => r.dashboards),

  createDashboard: (input: DashboardInput) =>
    http<Dashboard>("/api/dashboards", { method: "POST", body: JSON.stringify(input) }),

  updateDashboard: (id: string, input: DashboardInput) =>
    http<Dashboard>(`/api/dashboards/${id}`, { method: "PUT", body: JSON.stringify(input) }),

  deleteDashboard: (id: string) => http<void>(`/api/dashboards/${id}`, { method: "DELETE" }),

  previewReport: (spec: ReportSpec) =>
    http<PreviewResult & { viz: Viz }>("/api/reports/preview", {
      method: "POST",
      body: JSON.stringify(spec),
    }),

  createReport: (name: string, spec: ReportSpec, description?: string) =>
    http<Metric>("/api/reports", {
      method: "POST",
      body: JSON.stringify({ name, description, spec }),
    }),

  listPredefined: () =>
    http<{ reports: PredefinedReportMeta[] }>("/api/predefined").then((r) => r.reports),

  predefinedOptions: (id: string) => http<ReportOptions>(`/api/predefined/${id}/options`),

  runPredefined: (id: string, params: Record<string, unknown>) =>
    http<ReportOutput>(`/api/predefined/${id}/run`, {
      method: "POST",
      body: JSON.stringify({ params }),
    }),

  me: () => http<AuthState>("/api/auth/me"),

  login: (username: string, password: string) =>
    http<{ user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }).then((r) => r.user),

  register: (username: string, password: string, role?: "admin" | "viewer") =>
    http<{ user: AuthUser }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, role }),
    }).then((r) => r.user),

  logout: () => http<void>("/api/auth/logout", { method: "POST" }),
};
