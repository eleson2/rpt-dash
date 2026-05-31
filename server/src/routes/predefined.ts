import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { requireAuth } from "../auth/guards.js";
import { getPredefinedReport, predefinedReports } from "../predefined/registry.js";
import { toMeta } from "../predefined/types.js";

export async function predefinedRoutes(app: FastifyInstance) {
  const auth = { preHandler: requireAuth };

  // List available predefined reports (metadata + control descriptors).
  app.get("/api/predefined", auth, async () => ({
    reports: predefinedReports.map(toMeta),
  }));

  // Dynamic option lists for a report's controls (distinct values, date range).
  app.get("/api/predefined/:id/options", auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const report = getPredefinedReport(id);
    if (!report) return reply.code(404).send({ error: "Report not found" });
    try {
      return await report.options();
    } catch (err) {
      req.log.error(err);
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Run a report with the user-selected parameters.
  app.post("/api/predefined/:id/run", auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const report = getPredefinedReport(id);
    if (!report) return reply.code(404).send({ error: "Report not found" });
    try {
      return await report.run((req.body as { params?: unknown })?.params ?? {});
    } catch (err) {
      req.log.error(err);
      if (err instanceof ZodError) {
        return reply.code(400).send({ error: "Validation failed", issues: err.issues });
      }
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
