import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Dashboard, DashboardTile } from "../api/types";

export function DashboardComposer() {
  const qc = useQueryClient();
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: api.listMetrics });
  const dashboards = useQuery({ queryKey: ["dashboards"], queryFn: api.listDashboards });

  const [editing, setEditing] = useState<Dashboard | null>(null);
  const [name, setName] = useState("");
  const [tiles, setTiles] = useState<DashboardTile[]>([]);

  const reset = () => {
    setEditing(null);
    setName("");
    setTiles([]);
  };

  const load = (d: Dashboard) => {
    setEditing(d);
    setName(d.name);
    setTiles(d.layout);
  };

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.updateDashboard(editing.id, { name, layout: tiles })
        : api.createDashboard({ name, layout: tiles }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboards"] });
      reset();
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api.deleteDashboard(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboards"] });
      if (editing) reset();
    },
  });

  const metricName = (id: string) => metrics.data?.find((m) => m.id === id)?.name ?? id;

  const addTile = (metricId: string) =>
    setTiles([...tiles, { metricId, w: 6, h: 4 }]);
  const setWidth = (i: number, w: number) =>
    setTiles(tiles.map((t, j) => (j === i ? { ...t, w } : t)));
  const removeTile = (i: number) => setTiles(tiles.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= tiles.length) return;
    const next = [...tiles];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setTiles(next);
  };

  return (
    <div className="stack">
      <section className="card">
        <h2>{editing ? `Edit “${editing.name}”` : "New dashboard"}</h2>
        <div className="form-grid">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Add tile
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) addTile(e.target.value);
                e.target.value = "";
              }}
            >
              <option value="">— pick a metric —</option>
              {metrics.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="tiles">
          {tiles.length === 0 && <div className="muted">No tiles yet. Add a metric above.</div>}
          {tiles.map((t, i) => (
            <div key={i} className="tile-row">
              <span className="tile-index">{i + 1}</span>
              <strong>{metricName(t.metricId)}</strong>
              <label className="inline">
                width
                <select value={t.w} onChange={(e) => setWidth(i, Number(e.target.value))}>
                  {[3, 4, 6, 8, 12].map((w) => (
                    <option key={w} value={w}>
                      {w}/12
                    </option>
                  ))}
                </select>
              </label>
              <button className="link" onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button className="link" onClick={() => move(i, 1)} disabled={i === tiles.length - 1}>
                ↓
              </button>
              <button className="link danger" onClick={() => removeTile(i)}>
                remove
              </button>
            </div>
          ))}
        </div>

        <div className="filters">
          <button onClick={() => save.mutate()} disabled={!name || save.isPending}>
            {save.isPending ? "Saving…" : editing ? "Update dashboard" : "Create dashboard"}
          </button>
          {editing && (
            <button className="link" onClick={reset}>
              cancel
            </button>
          )}
        </div>
        {save.isError && <div className="error">{(save.error as Error).message}</div>}
      </section>

      <section className="card">
        <h2>Existing dashboards</h2>
        {dashboards.data?.length === 0 && <div className="muted">None yet.</div>}
        {dashboards.data?.map((d) => (
          <div key={d.id} className="dataset-row">
            <strong>{d.name}</strong> <span className="muted">{d.layout.length} tiles</span>{" "}
            <button className="link" onClick={() => load(d)}>
              edit
            </button>
            <button className="link danger" onClick={() => del.mutate(d.id)}>
              delete
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
