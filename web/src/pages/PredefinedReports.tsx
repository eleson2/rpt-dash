import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { PredefinedControl, PredefinedReportMeta, ReportOptions } from "../api/types";
import { StackedAreaChart } from "../components/StackedAreaChart";

type Params = Record<string, unknown>;

function optList(options: ReportOptions | undefined, key: string): string[] {
  const v = options?.[key];
  return Array.isArray(v) ? v.map(String) : [];
}

/** Build default param values from a report's controls + its option lists. */
function defaultsFor(report: PredefinedReportMeta, options: ReportOptions): Params {
  const p: Params = {};
  for (const c of report.controls) {
    if (c.type === "single") p[c.name] = optList(options, c.optionsKey)[0] ?? "";
    else if (c.type === "multi") p[c.name] = [];
    else if (c.type === "date") p[c.name] = (c.defaultKey ? options[c.defaultKey] : "") ?? "";
  }
  return p;
}

export function PredefinedReports() {
  const reports = useQuery({ queryKey: ["predefined"], queryFn: api.listPredefined });
  const [selectedId, setSelectedId] = useState<string>("");

  const report = reports.data?.find((r) => r.id === selectedId) ?? reports.data?.[0];
  const activeId = report?.id ?? "";

  const options = useQuery({
    queryKey: ["predefined-options", activeId],
    queryFn: () => api.predefinedOptions(activeId),
    enabled: !!activeId,
  });

  const [params, setParams] = useState<Params>({});

  // Seed defaults once options arrive (or the selected report changes).
  useEffect(() => {
    if (report && options.data) setParams(defaultsFor(report, options.data));
  }, [report?.id, options.data]);

  const run = useMutation({
    mutationFn: () => api.runPredefined(activeId, params),
  });

  if (reports.isLoading) return <div className="muted">Loading reports…</div>;
  if (!report) return <div className="muted">No predefined reports available.</div>;

  return (
    <div className="stack">
      {reports.data && reports.data.length > 1 && (
        <div className="report-buttons">
          {reports.data.map((r) => (
            <button
              key={r.id}
              className={r.id === activeId ? "tab active" : "tab"}
              onClick={() => setSelectedId(r.id)}
            >
              {r.title}
            </button>
          ))}
        </div>
      )}

      <section className="card">
        <h2>{report.title}</h2>
        <p className="muted">{report.description}</p>

        {options.isError && <div className="error">{(options.error as Error).message}</div>}

        <div className="controls">
          {report.controls.map((c) => (
            <Control
              key={c.name}
              control={c}
              options={options.data}
              value={params[c.name]}
              onChange={(v) => setParams((p) => ({ ...p, [c.name]: v }))}
            />
          ))}
        </div>

        <button onClick={() => run.mutate()} disabled={!options.data || run.isPending}>
          {run.isPending ? "Running…" : "Run report"}
        </button>
        {run.isError && <div className="error">{(run.error as Error).message}</div>}

        {run.data && (
          <div className="preview-block">
            {run.data.series.length === 0 ? (
              <div className="muted">No data for the selected filters.</div>
            ) : (
              <StackedAreaChart output={run.data} />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Control({
  control,
  options,
  value,
  onChange,
}: {
  control: PredefinedControl;
  options: ReportOptions | undefined;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (control.type === "single") {
    const opts = optList(options, control.optionsKey);
    return (
      <label>
        {control.label}
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {opts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (control.type === "date") {
    return (
      <label>
        {control.label}
        <input type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }

  // multi-select: checkboxes; selected items are shown individually, rest -> "Other"
  const opts = optList(options, control.optionsKey);
  const selected = Array.isArray(value) ? (value as string[]) : [];
  const toggle = (o: string) =>
    onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);
  return (
    <div className="multi-control">
      <div className="muted small">{control.label}</div>
      <div className="checkbox-row">
        {opts.map((o) => (
          <label key={o} className="inline">
            <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
            {o}
          </label>
        ))}
        {opts.length === 0 && <span className="muted small">no options</span>}
      </div>
    </div>
  );
}
