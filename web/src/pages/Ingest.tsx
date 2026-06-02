import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ColumnMeta } from "../api/types";

export function Ingest() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const datasets = useQuery({ queryKey: ["datasets"], queryFn: api.listDatasets });

  const upload = useMutation({
    mutationFn: () => api.uploadDataset(file!, name || undefined),
    onSuccess: () => {
      setFile(null);
      setName("");
      qc.invalidateQueries({ queryKey: ["datasets"] });
    },
  });

  return (
    <div className="stack">
      <section className="card">
        <h2>Upload a dataset</h2>
        <p className="muted">
          CSV, Parquet, or JSON. The file is staged on the server and exposed as a DuckDB view
          queried in place.
        </p>
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            if (file) upload.mutate();
          }}
        >
          <label>
            View name (optional)
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. sales" />
          </label>
          <label>
            File
            <input
              type="file"
              accept=".csv,.tsv,.txt,.parquet,.pq,.json,.ndjson,.jsonl"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button type="submit" disabled={!file || upload.isPending}>
            {upload.isPending ? "Uploading…" : "Upload"}
          </button>
        </form>
        {upload.isError && <div className="error">{(upload.error as Error).message}</div>}
        {upload.isSuccess && <div className="ok">Registered view “{upload.data.name}”.</div>}
      </section>

      <section className="card">
        <h2>Datasets</h2>
        {datasets.isLoading && <div className="muted">Loading…</div>}
        {datasets.data?.length === 0 && <div className="muted">No datasets yet.</div>}
        {datasets.data?.map((d) => (
          <div key={d.id} className="dataset-row">
            <strong>{d.name}</strong> <span className="badge">{d.format}</span>{" "}
            <span className="muted">{d.rowEstimate.toLocaleString()} rows</span>{" "}
            <button className="link" onClick={() => setEditing(editing === d.name ? null : d.name)}>
              {editing === d.name ? "close" : "edit columns"}
            </button>
            <div className="muted small">
              {d.columns.map((c) => `${c.name}: ${c.type}`).join("  ·  ")}
            </div>
            {editing === d.name && <ColumnEditor dataset={d.name} onDone={() => setEditing(null)} />}
          </div>
        ))}
      </section>
    </div>
  );
}

interface Draft {
  column: string;
  type: string;
  label: string;
  visible: boolean;
}

/** Admin editor: rename (label) and hide columns for one dataset's view. */
function ColumnEditor({ dataset, onDone }: { dataset: string; onDone: () => void }) {
  const qc = useQueryClient();
  const cols = useQuery({
    queryKey: ["dataset-columns", dataset],
    queryFn: () => api.getDatasetColumns(dataset),
  });

  const [drafts, setDrafts] = useState<Draft[]>([]);

  // Seed editable rows from physical columns + the stored curation overlay.
  useEffect(() => {
    if (!cols.data) return;
    const byCol = new Map(cols.data.curation.map((c) => [c.column, c]));
    setDrafts(
      cols.data.physical.map((p) => {
        const m = byCol.get(p.name);
        return {
          column: p.name,
          type: p.type,
          label: m?.label ?? "",
          visible: m ? m.visible : true,
        };
      }),
    );
  }, [cols.data]);

  const save = useMutation({
    mutationFn: () => {
      const entries: ColumnMeta[] = drafts.map((d, i) => ({
        column: d.column,
        label: d.label.trim() ? d.label.trim() : null,
        visible: d.visible,
        sortOrder: i,
      }));
      return api.saveDatasetColumns(dataset, entries);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["datasets"] });
      qc.invalidateQueries({ queryKey: ["dataset-columns", dataset] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
    },
  });

  if (cols.isLoading) return <div className="muted small">Loading columns…</div>;
  if (cols.isError) return <div className="error">{(cols.error as Error).message}</div>;

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const warnings = save.data?.migration.warnings ?? [];

  return (
    <div className="column-editor">
      <table className="column-editor-table">
        <thead>
          <tr>
            <th>Show</th>
            <th>Column</th>
            <th>Type</th>
            <th>Label (shown in reports)</th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((d, i) => (
            <tr key={d.column} className={d.visible ? undefined : "muted"}>
              <td>
                <input
                  type="checkbox"
                  checked={d.visible}
                  onChange={(e) => update(i, { visible: e.target.checked })}
                />
              </td>
              <td>
                <code>{d.column}</code>
              </td>
              <td className="muted small">{d.type}</td>
              <td>
                <input
                  value={d.label}
                  placeholder={d.column}
                  disabled={!d.visible}
                  onChange={(e) => update(i, { label: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="filters">
        <button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save columns"}
        </button>
        <button className="link" onClick={onDone}>
          done
        </button>
      </div>
      {save.isError && <div className="error">{(save.error as Error).message}</div>}
      {save.isSuccess && (
        <div className="ok">
          Saved.
          {save.data.migration.migrated.length > 0 &&
            ` Updated ${save.data.migration.migrated.length} saved report(s).`}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="error">
          These saved reports reference hidden columns and need attention: {warnings.join(", ")}.
        </div>
      )}
    </div>
  );
}
