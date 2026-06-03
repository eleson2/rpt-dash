import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { config } from "../config.js";
import { listDatasets, recurateView, registerDataset } from "../ingest/upload.js";
import {
  type ColumnMeta,
  effectiveAlias,
  getCuration,
  setCuration,
} from "../ingest/curation.js";
import { formatFromFilename } from "../ingest/introspect.js";
import { KEY_ROLES, setDatasetModel } from "../ingest/model.js";
import { predefinedReports } from "../predefined/registry.js";
import { migrateVisualReports } from "../reports/migrate.js";
import { requireAdmin, requireAuth } from "../auth/guards.js";

const curationBodySchema = z.object({
  columns: z
    .array(
      z.object({
        column: z.string().min(1),
        label: z.string().nullable().optional(),
        visible: z.boolean().default(true),
        sortOrder: z.number().int().nullable().optional(),
      }),
    )
    .min(1),
});

const modelBodySchema = z.object({
  description: z.string().nullable().optional(),
  family: z.string().nullable().optional(),
  keys: z
    .array(z.object({ column: z.string().min(1), role: z.enum(KEY_ROLES as [string, ...string[]]) }))
    .default([]),
});

export async function datasetRoutes(app: FastifyInstance) {
  // Only logical data sources (combined views + uploads); per-file discovery
  // entries are internal and hidden behind their combined view.
  app.get("/api/datasets", { preHandler: requireAuth }, async () => ({
    datasets: listDatasets().filter((d) => d.kind !== "file"),
  }));

  // Physical schema + current curation overlay for a dataset's columns.
  app.get("/api/datasets/:name/columns", { preHandler: requireAuth }, async (req, reply) => {
    const { name } = req.params as { name: string };
    const ds = listDatasets().find((d) => d.name === name);
    if (!ds) return reply.code(404).send({ error: `Unknown dataset: ${name}` });
    return { physical: ds.rawColumns, curation: getCuration(name) };
  });

  // Curate a dataset's columns (admin): persist labels/visibility, rebuild the
  // view, and re-bake any saved reports that referenced renamed columns.
  app.put("/api/datasets/:name/columns", { preHandler: requireAdmin }, async (req, reply) => {
    const { name } = req.params as { name: string };
    const ds = listDatasets().find((d) => d.name === name);
    if (!ds) return reply.code(404).send({ error: `Unknown dataset: ${name}` });

    try {
      const body = curationBodySchema.parse(req.body);
      const physical = new Set(ds.rawColumns.map((c) => c.name));
      const entries: ColumnMeta[] = body.columns.map((c, i) => {
        if (!physical.has(c.column)) {
          throw new Error(`Unknown column "${c.column}" in dataset ${name}`);
        }
        return {
          column: c.column,
          label: c.label?.trim() ? c.label.trim() : null,
          visible: c.visible,
          sortOrder: c.sortOrder ?? i,
        };
      });

      // Effective exposed name (or null = hidden) for a column, under a curation set.
      const exposedUnder = (set: ColumnMeta[], col: string): string | null => {
        const m = set.find((e) => e.column === col);
        if (!m) return col; // uncurated → visible under physical name
        return m.visible ? effectiveAlias(m) : null;
      };

      // Refuse to rename/hide a column a predefined report depends on (those
      // reports reference columns by physical name against this view).
      for (const rep of predefinedReports) {
        if (rep.view !== name) continue;
        for (const rc of rep.requiredColumns ?? []) {
          const exposed = exposedUnder(entries, rc);
          if (exposed === null) {
            throw new Error(
              `Cannot hide column "${rc}": predefined report "${rep.title}" depends on it.`,
            );
          }
          if (exposed !== rc) {
            throw new Error(
              `Cannot rename column "${rc}": predefined report "${rep.title}" depends on its name.`,
            );
          }
        }
      }

      // Map old exposed name → new exposed name for columns visible in both.
      const current = getCuration(name);
      const renames = new Map<string, string>();
      for (const c of ds.rawColumns) {
        const oldName = exposedUnder(current, c.name);
        const newName = exposedUnder(entries, c.name);
        if (oldName && newName && oldName !== newName) renames.set(oldName, newName);
      }

      setCuration(name, entries);
      const dataset = await recurateView(name);
      const migration = migrateVisualReports(name, renames);
      return { dataset, migration };
    } catch (err) {
      req.log.error(err);
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Describe a data source (admin): description, family, and conformed join
  // keys. Pure catalog metadata — no view rebuild.
  app.put("/api/datasets/:name/model", { preHandler: requireAdmin }, async (req, reply) => {
    const { name } = req.params as { name: string };
    const ds = listDatasets().find((d) => d.name === name);
    if (!ds) return reply.code(404).send({ error: `Unknown dataset: ${name}` });

    try {
      const body = modelBodySchema.parse(req.body);
      // Keys reference physical columns (stable across curation renames).
      const physical = new Set(ds.rawColumns.map((c) => c.name));
      for (const k of body.keys) {
        if (!physical.has(k.column)) {
          throw new Error(`Unknown column "${k.column}" in dataset ${name}`);
        }
      }
      setDatasetModel(name, {
        description: body.description ?? null,
        family: body.family ?? null,
        keys: body.keys.map((k) => ({ column: k.column, role: k.role as (typeof KEY_ROLES)[number] })),
      });
      const dataset = listDatasets().find((d) => d.name === name)!;
      return { dataset };
    } catch (err) {
      req.log.error(err);
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Multipart upload (admin only): stream the file to staging, then register it as a view.
  app.post("/api/datasets/upload", { preHandler: requireAdmin }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "No file uploaded" });

    const format = formatFromFilename(file.filename);
    if (!format) {
      return reply
        .code(400)
        .send({ error: "Unsupported file type (expected .parquet, .csv, or .json)" });
    }

    const name = (file.fields?.["name"] as { value?: string } | undefined)?.value ?? file.filename;
    const stagedPath = join(config.stagingDir, `${nanoid(8)}-${file.filename}`);
    await pipeline(file.file, createWriteStream(stagedPath));

    if (file.file.truncated) {
      return reply.code(413).send({ error: "File exceeds upload size limit" });
    }

    try {
      const dataset = await registerDataset({ name, format, absPath: stagedPath });
      return reply.code(201).send({ dataset });
    } catch (err) {
      req.log.error(err);
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
