import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { MetricCard } from "../components/MetricCard";

export function Dashboard() {
  const qc = useQueryClient();
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: api.listMetrics });

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

  return (
    <div className="grid">
      {metrics.data?.map((m) => (
        <MetricCard key={m.id} metric={m} onDelete={() => del.mutate(m.id)} />
      ))}
    </div>
  );
}
