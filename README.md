# rpt-dash

A reporting dashboard and analysis tool built on top of **DuckDB**, served in the browser
with a Node/TypeScript server that owns the database connection.

## Status

Phase 1 vertical slice working: upload a CSV/Parquet/JSON file → it's registered as a DuckDB
view (queried in place) → define a curated, parameterized metric → render it as a chart or table
in the browser.

## Architecture

```
web/  (React + Vite + TS, ECharts, TanStack Query)
  │  /api  (Vite proxy in dev; same origin in prod)
  ▼
server/  (Fastify + TS)
  ├── DuckDB  (@duckdb/node-api)  — analytics over file-backed views (read path)
  └── SQLite  (better-sqlite3)    — metric/dashboard defs + ingest catalog
        data/  → analytics.duckdb, metadata.sqlite, staging/<uploads>
```

- **Curated queries:** metrics are server-stored parameterized SQL. The browser sends a metric id
  plus filter values; values are validated (zod) and bound as DuckDB query parameters. SQL is
  re-checked to be a single read-only `SELECT`/`WITH` before running, and results are row-capped.
- **Files queried in place:** uploads become `CREATE OR REPLACE VIEW … read_parquet/read_csv_auto/
  read_json_auto(...)` (zero-copy). Structural writes are serialized via a write lock.

> **Security note (v1 has no auth):** the metric builder authors SQL, so keep this on a trusted
> network until auth is added. The runtime query path validates SQL is read-only as defense-in-depth.

## Run it (development)

Two terminals:

```bash
# 1) API server  →  http://localhost:3001
cd server
npm install
npm run dev

# 2) Web app     →  http://localhost:5173  (proxies /api to the server)
cd web
npm install
npm run dev
```

Then in the browser:
1. **Datasets** tab → upload `sample-data/sales.csv` (name it `sales`).
2. **Metric builder** tab → create a metric, e.g.
   - SQL: `SELECT date_trunc('month', CAST(ts AS DATE)) AS month, sum(amount) AS total FROM sales WHERE region = $region GROUP BY 1 ORDER BY 1`
   - Param: `region` (string, required); Viz: line, x=`month`, y=`total`.
3. **Dashboard** tab → set `region` = `North`, Apply, see the chart.

## Run it (Docker, single container)

```bash
docker compose up --build      # → http://localhost:3001  (serves the built SPA + API)
```

Data persists in the `rpt-dash-data` volume (`/data`).

## Useful scripts

```bash
# server/
npm run dev        # watch-mode API server
npm run smoke      # exercise the DuckDB pipeline end-to-end (no HTTP)
npm test           # unit tests (SQL read-only guard, param validation)
npm run typecheck

# web/
npm run dev        # Vite dev server
npm run build      # typecheck + production build
```

## Project layout

- `server/src/db/` — DuckDB access (read pool + write lock) and SQLite metadata schema
- `server/src/metrics/` — metric types/validation, store (CRUD), and the read-only runner
- `server/src/ingest/` — file introspection and view registration
- `server/src/routes/` — `/api/datasets`, `/api/metrics`, `/api/dashboards`
- `web/src/pages/` — Dashboard, MetricBuilder, Ingest
- `web/src/components/` — ECharts wrapper + metric card

See `plans/` referenced design notes for the phased roadmap (auth, Arrow transport, caching).
