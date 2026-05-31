import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  createMetric,
  deleteMetric,
  getMetric,
  listMetrics,
  updateMetric,
} from "../metrics/store.js";
import { previewQuery, runMetric } from "../metrics/run.js";
import { metricInputSchema, paramDefSchema } from "../metrics/types.js";
import { requireAdmin, requireAuth } from "../auth/guards.js";
import { z } from "zod";

const previewSchema = z.object({
  sql: z.string().min(1),
  params: z.array(paramDefSchema).default([]),
  values: z.record(z.string(), z.unknown()).default({}),
});

export async function metricRoutes(app: FastifyInstance) {
  // Reads require any authenticated user; authoring requires an admin.
  const read = { preHandler: requireAuth };
  const admin = { preHandler: requireAdmin };

  app.get("/api/metrics", read, async () => ({ metrics: listMetrics() }));

  app.get("/api/metrics/:id", read, async (req, reply) => {
    const { id } = req.params as { id: string };
    const metric = getMetric(id);
    return metric ? metric : reply.code(404).send({ error: "Metric not found" });
  });

  app.post("/api/metrics", admin, async (req, reply) => {
    try {
      const input = metricInputSchema.parse(req.body);
      return reply.code(201).send(createMetric(input));
    } catch (err) {
      return badRequest(reply, err);
    }
  });

  // Preview unsaved SQL for the metric builder.
  app.post("/api/metrics/preview", admin, async (req, reply) => {
    try {
      const input = previewSchema.parse(req.body);
      return await previewQuery(input);
    } catch (err) {
      req.log.error(err);
      return badRequest(reply, err);
    }
  });

  app.put("/api/metrics/:id", admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const input = metricInputSchema.parse(req.body);
      const updated = updateMetric(id, input);
      return updated ? updated : reply.code(404).send({ error: "Metric not found" });
    } catch (err) {
      return badRequest(reply, err);
    }
  });

  app.delete("/api/metrics/:id", admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    return deleteMetric(id) ? reply.code(204).send() : reply.code(404).send({ error: "Metric not found" });
  });

  // Run a metric with caller-supplied filter params.
  app.post("/api/metrics/:id/run", read, async (req, reply) => {
    const { id } = req.params as { id: string };
    const metric = getMetric(id);
    if (!metric) return reply.code(404).send({ error: "Metric not found" });

    const params = (req.body as { params?: Record<string, unknown> } | undefined)?.params ?? {};
    try {
      const result = await runMetric(metric, params);
      return result;
    } catch (err) {
      req.log.error(err);
      return badRequest(reply, err);
    }
  });
}

function badRequest(reply: import("fastify").FastifyReply, err: unknown) {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: "Validation failed", issues: err.issues });
  }
  return reply.code(400).send({ error: (err as Error).message });
}
