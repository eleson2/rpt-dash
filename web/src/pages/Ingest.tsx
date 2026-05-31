import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export function Ingest() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");

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
            <span className="muted">{d.rowEstimate.toLocaleString()} rows</span>
            <div className="muted small">
              {d.columns.map((c) => `${c.name}: ${c.type}`).join("  ·  ")}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
