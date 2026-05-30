# rpt-dash 

A reporting dashboard and analysis tool built on top of **DuckDB**, served in the browser
with a Node/TypeScript server that owns the database connection.

## Status

Early planning. See the architecture plan (handed to Ultraplan for refinement).

## Target architecture (first stage)

- **Frontend:** React + Vite + TypeScript SPA (dashboards, charts, filters).
- **Backend:** Fastify (TypeScript) API server owning the DuckDB connection.
- **Analytics store:** DuckDB (read-heavy; CSV / Parquet / JSON ingest).
- **Metadata store:** SQLite (users, dashboards, metric definitions, ingest catalog).
- **Query model:** curated, server-defined parameterized metrics via prepared statements —
  no raw SQL from the browser.

## Scope

Small team on a shared server: session-based auth, concurrent reads with serialized ingest.
