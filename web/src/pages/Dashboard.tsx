import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { MetricCard } from "../components/MetricCard";

export function Dashboard() {
  const qc = useQueryClient();
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: api.listMetrics });
  const dashboards = useQuery({ queryKey: ["dashboards"], queryFn: api.listDashboards });
  const [selected, setSelected] = useState<string>("__all__");

  const del = useMutation({
    mutationFn: (id: string) => api.deleteMetric(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["metrics"] }),
  });

  if (metrics.isLoading) return <div className="muted">Loading metrics…</div>;
  if (metrics.data?.length === 0)
    return (
      <div className="muted">
        No metrics yet. Upload a dataset and create a metric to see it here.
      </div>
    );

  const dashboard = dashboards.data?.find((d) => d.id === selected);

  // A saved dashboard renders its ordered tiles with per-tile widths; the
  // "All metrics" view falls back to every metric at a default width.
  const tiles = dashboard
    ? dashboard.layout
        .map((t) => ({ metric: metrics.data?.find((m) => m.id === t.metricId), w: t.w }))
        .filter((t): t is { metric: NonNullable<typeof t.metric>; w: number } => !!t.metric)
    : metrics.data!.map((m) => ({ metric: m, w: 6 }));

  return (
    <div className="stack">
      <div className="filters">
        <label>
          View
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="__all__">All metrics</option>
            {dashboards.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="dash-grid">
        {tiles.map(({ metric, w }, i) => (
          <MetricCard
            key={`${metric.id}-${i}`}
            metric={metric}
            style={{ gridColumn: `span ${w}` }}
            onDelete={selected === "__all__" ? () => del.mutate(metric.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
