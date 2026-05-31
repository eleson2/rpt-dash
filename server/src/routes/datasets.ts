import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { listDatasets, registerDataset } from "../ingest/upload.js";
import { formatFromFilename } from "../ingest/introspect.js";
import { requireAdmin, requireAuth } from "../auth/guards.js";

export async function datasetRoutes(app: FastifyInstance) {
  app.get("/api/datasets", { preHandler: requireAuth }, async () => ({ datasets: listDatasets() }));

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
