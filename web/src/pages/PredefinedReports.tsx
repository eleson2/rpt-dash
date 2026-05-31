import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  DrilldownSpec,
  PredefinedControl,
  PredefinedReportMeta,
  ReportOptions,
} from "../api/types";
import { StackedAreaChart } from "../components/StackedAreaChart";

type Params = Record<string, unknown>;

/** One level of the drill path: a clickable label + the params that produced it. */
type Crumb = { label: string; params: Params };

/** Parse a wall-clock category label ("YYYY-MM-DD HH:mm:ss") to a Date (local). */
function parseCategory(category: string): Date | null {
  const d = new Date(category.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

/** Format a Date as a wall-clock "YYYY-MM-DD HH:mm:ss" bound for the server. */
function toBound(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/**
 * Compute the params for drilling into a clicked time bucket: narrow the
 * from/to window to that bucket and step the granularity one level finer
 * (staying put if already finest). Returns null if the report isn't drillable
 * or the click can't be interpreted as a time bucket.
 */
function drillParams(spec: DrilldownSpec, params: Params, category: string): Params | null {
  const start = parseCategory(category);
  if (!start) return null;
  const current = String(params[spec.granularityParam] ?? "");
  const i = spec.ladder.findIndex((l) => l.value === current);
  const level = i < 0 ? undefined : spec.ladder[i];
  if (!level) return null;
  const end = new Date(start.getTime() + level.bucketMs);
  const next = (spec.ladder[Math.min(i + 1, spec.ladder.length - 1)] ?? level).value;
  return {
    ...params,
    [spec.fromParam]: toBound(start),
    // Exclusive upper bound: server compares `ts <= $to` at second precision.
    [spec.toParam]: toBound(new Date(end.getTime() - 1000)),
    [spec.granularityParam]: next,
  };
}

function optList(options: ReportOptions | undefined, key: string): string[] {
  const v = options?.[key];
  return Array.isArray(v) ? v.map(String) : [];
}

/** Format a date/datetime value for an <input type="datetime-local"> (YYYY-MM-DDTHH:mm). */
function toDateTimeLocal(v: unknown): string {
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00`;
  return s.replace(" ", "T").slice(0, 16);
}

/** Build default param values from a report's controls + its option lists. */
function defaultsFor(report: PredefinedReportMeta, options: ReportOptions): Params {
  const p: Params = {};
  for (const c of report.controls) {
    if (c.type === "single") {
      const opts = optList(options, c.optionsKey);
      p[c.name] = c.default && opts.includes(c.default) ? c.default : opts[0] ?? "";
    }
    else if (c.type === "multi") p[c.name] = [];
    else if (c.type === "date") p[c.name] = (c.defaultKey ? options[c.defaultKey] : "") ?? "";
    else if (c.type === "datetime") p[c.name] = toDateTimeLocal(c.defaultKey ? options[c.defaultKey] : "");
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
  // Drill path; the first crumb is the root (controls as run by the user).
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);

  // Seed defaults once options arrive (or the selected report changes).
  useEffect(() => {
    if (report && options.data) {
      setParams(defaultsFor(report, options.data));
      setCrumbs([]);
    }
  }, [report?.id, options.data]);

  const run = useMutation({
    mutationFn: (p: Params) => api.runPredefined(activeId, p),
  });

  // Run the report from the controls as a fresh root (clears any drill path).
  const runRoot = () => {
    setCrumbs([{ label: "All", params }]);
    run.mutate(params);
  };

  // Drill into a clicked time bucket: narrow + step finer, grow the breadcrumb.
  const drill = (category: string) => {
    if (!report?.drilldown) return;
    const next = drillParams(report.drilldown, params, category);
    if (!next) return;
    setParams(next);
    setCrumbs((c) => [...(c.length ? c : [{ label: "All", params }]), { label: category, params: next }]);
    run.mutate(next);
  };

  // Jump back to an earlier drill level: restore its params, drop trailing crumbs.
  const goToCrumb = (index: number) => {
    const target = crumbs[index];
    if (!target) return;
    setParams(target.params);
    setCrumbs((c) => c.slice(0, index + 1));
    run.mutate(target.params);
  };

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

        <button onClick={runRoot} disabled={!options.data || run.isPending}>
          {run.isPending ? "Running…" : "Run report"}
        </button>
        {run.isError && <div className="error">{(run.error as Error).message}</div>}

        {run.data && (
          <div className="preview-block">
            {report.drilldown && crumbs.length > 1 && (
              <nav className="breadcrumbs muted small">
                {crumbs.map((c, i) => (
                  <span key={i}>
                    {i > 0 && " › "}
                    {i < crumbs.length - 1 ? (
                      <button className="link" onClick={() => goToCrumb(i)}>
                        {c.label}
                      </button>
                    ) : (
                      <span className="current">{c.label}</span>
                    )}
                  </span>
                ))}
              </nav>
            )}
            {run.data.series.length === 0 ? (
              <div className="muted">No data for the selected filters.</div>
            ) : (
              <StackedAreaChart
                output={run.data}
                onPointClick={report.drilldown ? (p) => drill(p.category) : undefined}
              />
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

  if (control.type === "datetime") {
    return (
      <label>
        {control.label}
        <input
          type="datetime-local"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
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
