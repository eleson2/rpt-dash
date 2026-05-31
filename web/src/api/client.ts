import type { Dataset, Metric, MetricInput, RunResult } from "./types";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
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

  listMetrics: () => http<{ metrics: Metric[] }>("/api/metrics").then((r) => r.metrics),

  createMetric: (input: MetricInput) =>
    http<Metric>("/api/metrics", { method: "POST", body: JSON.stringify(input) }),

  deleteMetric: (id: string) => http<void>(`/api/metrics/${id}`, { method: "DELETE" }),

  runMetric: (id: string, params: Record<string, unknown>) =>
    http<RunResult>(`/api/metrics/${id}/run`, {
      method: "POST",
      body: JSON.stringify({ params }),
    }),
};
