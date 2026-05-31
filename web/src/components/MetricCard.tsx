import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Metric } from "../api/types";
import { Chart, ResultTable } from "./Chart";

/** A dashboard tile: renders param inputs, runs the metric, shows the chart/table. */
export function MetricCard({ metric, onDelete }: { metric: Metric; onDelete?: () => void }) {
  const [params, setParams] = useState<Record<string, string>>(
    Object.fromEntries(metric.params.map((p) => [p.name, ""])),
  );
  const [applied, setApplied] = useState<Record<string, string>>(params);

  const run = useQuery({
    queryKey: ["run", metric.id, applied],
    queryFn: () => api.runMetric(metric.id, applied),
  });

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <strong>{metric.name}</strong>
          {metric.description && <div className="muted">{metric.description}</div>}
        </div>
        {onDelete && (
          <button className="link danger" onClick={onDelete} title="Delete metric">
            ✕
          </button>
        )}
      </div>

      {metric.params.length > 0 && (
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied({ ...params });
          }}
        >
          {metric.params.map((p) => (
            <label key={p.name}>
              {p.name}
              <input
                type={p.type === "date" ? "date" : p.type === "number" ? "number" : "text"}
                value={params[p.name] ?? ""}
                onChange={(e) => setParams({ ...params, [p.name]: e.target.value })}
              />
            </label>
          ))}
          <button type="submit">Apply</button>
        </form>
      )}

      {run.isLoading && <div className="muted">Running…</div>}
      {run.isError && <div className="error">{(run.error as Error).message}</div>}
      {run.data &&
        (metric.viz.type === "table" ? (
          <ResultTable result={run.data} />
        ) : (
          <Chart result={run.data} viz={metric.viz} />
        ))}
      {run.data?.truncated && <div className="muted">Results truncated to row cap.</div>}
    </div>
  );
}
