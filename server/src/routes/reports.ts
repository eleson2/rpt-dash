import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { requireAuth } from "../auth/guards.js";
import { runQuery } from "../db/duckdb.js";
import { createMetric } from "../metrics/store.js";
import { buildReportSql } from "../reports/build.js";
import { reportInputSchema, reportSpecSchema } from "../reports/types.js";

export async function reportRoutes(app: FastifyInstance) {
  // Any authenticated user may build visual reports (no raw SQL is involved).
  const auth = { preHandler: requireAuth };

  // Preview a report from an unsaved spec.
  app.post("/api/reports/preview", auth, async (req, reply) => {
    try {
      const spec = reportSpecSchema.parse(req.body);
      const built = buildReportSql(spec);
      const result = await runQuery(built.sql, built.params);
      return { ...result, viz: built.viz, sql: built.sql };
    } catch (err) {
      req.log.error(err);
      return badRequest(reply, err);
    }
  });

  // Save a report as a (visual) metric so it shows up everywhere metrics do.
  app.post("/api/reports", auth, async (req, reply) => {
    try {
      const input = reportInputSchema.parse(req.body);
      const built = buildReportSql(input.spec);
      const metric = createMetric(
        {
          name: input.name,
          description: input.description,
          sql: built.sql,
          params: [],
          viz: built.viz,
        },
        {
          kind: "visual",
          spec: input.spec,
          fixedParams: built.params,
          ownerId: req.user?.id ?? null,
        },
      );
      return reply.code(201).send(metric);
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
