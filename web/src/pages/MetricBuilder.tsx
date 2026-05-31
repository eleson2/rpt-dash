import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ParamDef, ParamType, Viz } from "../api/types";

const PARAM_TYPES: ParamType[] = ["string", "number", "boolean", "date"];

export function MetricBuilder() {
  const qc = useQueryClient();
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: api.listDatasets });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sql, setSql] = useState("SELECT ... FROM your_view WHERE col = $param");
  const [params, setParams] = useState<ParamDef[]>([]);
  const [viz, setViz] = useState<Viz>({ type: "line", xField: "", yFields: [] });

  const create = useMutation({
    mutationFn: () =>
      api.createMetric({
        name,
        description: description || undefined,
        sql,
        params,
        viz: {
          ...viz,
          xField: viz.xField || undefined,
          yFields: viz.yFields.filter(Boolean),
        },
      }),
    onSuccess: () => {
      setName("");
      setDescription("");
      qc.invalidateQueries({ queryKey: ["metrics"] });
    },
  });

  const addParam = () =>
    setParams([...params, { name: "", type: "string", required: true }]);
  const updateParam = (i: number, patch: Partial<ParamDef>) =>
    setParams(params.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const removeParam = (i: number) => setParams(params.filter((_, j) => j !== i));

  return (
    <div className="stack">
      <section className="card">
        <h2>Create a metric</h2>
        <p className="muted">
          Available views:{" "}
          {datasets.data?.length
            ? datasets.data.map((d) => d.name).join(", ")
            : "none yet — upload a dataset first"}
          . Reference params in SQL as <code>$name</code>.
        </p>

        <div className="form-grid">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>

        <label className="block">
          SQL (single read-only SELECT/WITH)
          <textarea rows={5} value={sql} onChange={(e) => setSql(e.target.value)} />
        </label>

        <div className="params">
          <div className="card-head">
            <strong>Parameters</strong>
            <button className="link" onClick={addParam}>
              + add param
            </button>
          </div>
          {params.map((p, i) => (
            <div key={i} className="filters">
              <input
                placeholder="name"
                value={p.name}
                onChange={(e) => updateParam(i, { name: e.target.value })}
              />
              <select
                value={p.type}
                onChange={(e) => updateParam(i, { type: e.target.value as ParamType })}
              >
                {PARAM_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={p.required}
                  onChange={(e) => updateParam(i, { required: e.target.checked })}
                />
                required
              </label>
              <button className="link danger" onClick={() => removeParam(i)}>
                remove
              </button>
            </div>
          ))}
        </div>

        <div className="form-grid">
          <label>
            Viz type
            <select
              value={viz.type}
              onChange={(e) => setViz({ ...viz, type: e.target.value as Viz["type"] })}
            >
              <option value="line">line</option>
              <option value="bar">bar</option>
              <option value="table">table</option>
            </select>
          </label>
          <label>
            X field
            <input
              value={viz.xField ?? ""}
              onChange={(e) => setViz({ ...viz, xField: e.target.value })}
            />
          </label>
          <label>
            Y fields (comma-separated)
            <input
              value={viz.yFields.join(",")}
              onChange={(e) =>
                setViz({ ...viz, yFields: e.target.value.split(",").map((s) => s.trim()) })
              }
            />
          </label>
        </div>

        <button onClick={() => create.mutate()} disabled={!name || !sql || create.isPending}>
          {create.isPending ? "Saving…" : "Create metric"}
        </button>
        {create.isError && <div className="error">{(create.error as Error).message}</div>}
        {create.isSuccess && <div className="ok">Created “{create.data.name}”.</div>}
      </section>
    </div>
  );
}
