import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  Agg,
  Dimension,
  FilterOp,
  Measure,
  ReportFilter,
  ReportSpec,
  Transform,
  Viz,
} from "../api/types";
import { Chart, ResultTable } from "../components/Chart";

const AGGS: Agg[] = ["count", "sum", "avg", "min", "max"];
const TRANSFORMS: Transform[] = ["none", "year", "month", "day"];
const OPS: FilterOp[] = ["=", "!=", ">", ">=", "<", "<=", "in", "contains"];
const VIZ_TYPES: Viz["type"][] = ["bar", "line", "table"];

/**
 * Whether a column type can be bucketed by year/month/day. Mirrors the server
 * guard in reports/build.ts: only date/timestamp/text columns cast cleanly;
 * numeric and other types fail at query time.
 */
function isTemporalCastable(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.toUpperCase();
  return (
    t.includes("DATE") ||
    t.includes("TIMESTAMP") ||
    t.includes("TIME") ||
    t.includes("VARCHAR") ||
    t.includes("CHAR") ||
    t.includes("STRING") ||
    t.includes("TEXT")
  );
}

/** Numeric column types. Mirrors the server guard: sum/avg require numeric. */
function isNumericType(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.toUpperCase();
  return (
    t.includes("INT") ||
    t.includes("DECIMAL") ||
    t.includes("NUMERIC") ||
    t.includes("DOUBLE") ||
    t.includes("FLOAT") ||
    t.includes("REAL")
  );
}

/** Aggregations that only accept a numeric column. */
const NUMERIC_AGGS = new Set<Agg>(["sum", "avg"]);

/** No-code report builder: pick dataset → dimensions → measures → filters → chart. */
export function ReportBuilder() {
  const qc = useQueryClient();
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: api.listDatasets });

  const [name, setName] = useState("");
  const [dataset, setDataset] = useState("");
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [measures, setMeasures] = useState<Measure[]>([{ agg: "count" }]);
  const [filters, setFilters] = useState<ReportFilter[]>([]);
  const [vizType, setVizType] = useState<Viz["type"]>("bar");

  const columns = useMemo(
    () => datasets.data?.find((d) => d.name === dataset)?.columns ?? [],
    [datasets.data, dataset],
  );

  const spec = (): ReportSpec => ({
    dataset,
    dimensions,
    measures,
    filters: filters.map((f) =>
      f.op === "in"
        ? { ...f, value: String(f.value).split(",").map((s) => s.trim()).filter(Boolean) }
        : f,
    ),
    viz: { type: vizType, yFields: [] },
  });

  const preview = useMutation({ mutationFn: () => api.previewReport(spec()) });
  const save = useMutation({
    mutationFn: () => api.createReport(name, spec()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["metrics"] });
      setName("");
    },
  });

  const onPickDataset = (name: string) => {
    setDataset(name);
    setDimensions([]);
    setMeasures([{ agg: "count" }]);
    setFilters([]);
  };

  if (datasets.data?.length === 0)
    return <div className="muted">No data sources yet. Ask an admin to upload data first.</div>;

  return (
    <div className="stack">
      <section className="card">
        <h2>Build a report</h2>
        <div className="form-grid">
          <label>
            Report name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Data source
            <select value={dataset} onChange={(e) => onPickDataset(e.target.value)}>
              <option value="">— pick a data source —</option>
              {datasets.data?.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Chart
            <select value={vizType} onChange={(e) => setVizType(e.target.value as Viz["type"])}>
              {VIZ_TYPES.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        </div>

        {dataset && (
          <>
            {/* Dimensions (group by) */}
            <div className="builder-group">
              <div className="card-head">
                <strong>Group by</strong>
                <button
                  className="link"
                  onClick={() => setDimensions([...dimensions, { column: columns[0]?.name ?? "", transform: "none" }])}
                >
                  + dimension
                </button>
              </div>
              {dimensions.map((d, i) => {
                const dimType = columns.find((c) => c.name === d.column)?.type;
                const canBucket = isTemporalCastable(dimType);
                return (
                <div key={i} className="filters">
                  <select
                    value={d.column}
                    onChange={(e) => {
                      const column = e.target.value;
                      const nextTemporal = isTemporalCastable(columns.find((c) => c.name === column)?.type);
                      setDimensions(
                        dimensions.map((x, j) =>
                          // Drop a stale date bucket when switching to a non-temporal column.
                          j === i ? { ...x, column, transform: nextTemporal ? x.transform : "none" } : x,
                        ),
                      );
                    }}
                  >
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={d.transform}
                    disabled={!canBucket}
                    title={canBucket ? undefined : "Date bucketing needs a date, timestamp, or text column"}
                    onChange={(e) =>
                      setDimensions(
                        dimensions.map((x, j) => (j === i ? { ...x, transform: e.target.value as Transform } : x)),
                      )
                    }
                  >
                    {(canBucket ? TRANSFORMS : (["none"] as Transform[])).map((t) => (
                      <option key={t} value={t}>
                        {t === "none" ? "(exact)" : `by ${t}`}
                      </option>
                    ))}
                  </select>
                  <button className="link danger" onClick={() => setDimensions(dimensions.filter((_, j) => j !== i))}>
                    remove
                  </button>
                </div>
                );
              })}
            </div>

            {/* Measures (aggregations) */}
            <div className="builder-group">
              <div className="card-head">
                <strong>Measure</strong>
                <button
                  className="link"
                  onClick={() => {
                    const firstNumeric = columns.find((c) => isNumericType(c.type))?.name;
                    setMeasures([
                      ...measures,
                      firstNumeric ? { agg: "sum", column: firstNumeric } : { agg: "count" },
                    ]);
                  }}
                >
                  + measure
                </button>
              </div>
              {measures.map((m, i) => {
                // sum/avg only accept numeric columns; other aggs accept any.
                const colOptions = NUMERIC_AGGS.has(m.agg)
                  ? columns.filter((c) => isNumericType(c.type))
                  : columns;
                return (
                <div key={i} className="filters">
                  <select
                    value={m.agg}
                    onChange={(e) => {
                      const agg = e.target.value as Agg;
                      setMeasures(
                        measures.map((x, j) => {
                          if (j !== i) return x;
                          if (agg === "count") return { agg, column: x.column };
                          let column = x.column ?? columns[0]?.name;
                          // Switching to sum/avg with a non-numeric column → pick a numeric one.
                          if (NUMERIC_AGGS.has(agg) && !isNumericType(columns.find((c) => c.name === column)?.type)) {
                            column = columns.find((c) => isNumericType(c.type))?.name;
                          }
                          return { agg, column };
                        }),
                      );
                    }}
                  >
                    {AGGS.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                  <select
                    value={m.column ?? ""}
                    onChange={(e) =>
                      setMeasures(measures.map((x, j) => (j === i ? { ...x, column: e.target.value || undefined } : x)))
                    }
                  >
                    <option value="">{m.agg === "count" ? "(all rows)" : "— column —"}</option>
                    {colOptions.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {measures.length > 1 && (
                    <button className="link danger" onClick={() => setMeasures(measures.filter((_, j) => j !== i))}>
                      remove
                    </button>
                  )}
                </div>
                );
              })}
            </div>

            {/* Filters */}
            <div className="builder-group">
              <div className="card-head">
                <strong>Filters</strong>
                <button
                  className="link"
                  onClick={() => setFilters([...filters, { column: columns[0]?.name ?? "", op: "=", value: "" }])}
                >
                  + filter
                </button>
              </div>
              {filters.map((f, i) => (
                <div key={i} className="filters">
                  <select
                    value={f.column}
                    onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))}
                  >
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={f.op}
                    onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, op: e.target.value as FilterOp } : x)))}
                  >
                    {OPS.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                  <input
                    placeholder={f.op === "in" ? "a, b, c" : "value"}
                    value={String(f.value)}
                    onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  />
                  <button className="link danger" onClick={() => setFilters(filters.filter((_, j) => j !== i))}>
                    remove
                  </button>
                </div>
              ))}
            </div>

            <div className="filters">
              <button className="link" onClick={() => preview.mutate()} disabled={preview.isPending}>
                {preview.isPending ? "Running…" : "Run preview"}
              </button>
              <button onClick={() => save.mutate()} disabled={!name || save.isPending}>
                {save.isPending ? "Saving…" : "Save report"}
              </button>
            </div>
            {preview.isError && <div className="error">{(preview.error as Error).message}</div>}
            {save.isError && <div className="error">{(save.error as Error).message}</div>}
            {save.isSuccess && <div className="ok">Saved “{save.data.name}” — find it on the Dashboard.</div>}

            {preview.data && (
              <div className="preview-block">
                {vizType === "table" ? (
                  <ResultTable result={{ ...preview.data, metricId: "" }} />
                ) : (
                  <Chart result={{ ...preview.data, metricId: "" }} viz={preview.data.viz} />
                )}
                {preview.data.truncated && <div className="muted">Preview truncated.</div>}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
