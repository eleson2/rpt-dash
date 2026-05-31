import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import { meta } from "../db/metadata.js";
import { requireAdmin, requireAuth } from "../auth/guards.js";

const tileSchema = z.object({
  metricId: z.string(),
  w: z.number().int().min(1).max(12).default(6),
  h: z.number().int().min(1).max(12).default(4),
});
const dashboardInput = z.object({
  name: z.string().min(1),
  layout: z.array(tileSchema).default([]),
});

interface DashboardRow {
  id: string;
  name: string;
  layout: string;
  created_at: string;
  updated_at: string;
}

function toDashboard(r: DashboardRow) {
  return {
    id: r.id,
    name: r.name,
    layout: JSON.parse(r.layout),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function dashboardRoutes(app: FastifyInstance) {
  const read = { preHandler: requireAuth };
  const admin = { preHandler: requireAdmin };

  app.get("/api/dashboards", read, async () => {
    const rows = meta.prepare("SELECT * FROM dashboards ORDER BY name").all() as DashboardRow[];
    return { dashboards: rows.map(toDashboard) };
  });

  app.get("/api/dashboards/:id", read, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = meta.prepare("SELECT * FROM dashboards WHERE id = ?").get(id) as DashboardRow | undefined;
    return row ? toDashboard(row) : reply.code(404).send({ error: "Dashboard not found" });
  });

  app.post("/api/dashboards", admin, async (req, reply) => {
    const parsed = dashboardInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues });
    const id = nanoid(12);
    meta
      .prepare("INSERT INTO dashboards (id, name, layout) VALUES (?, ?, ?)")
      .run(id, parsed.data.name, JSON.stringify(parsed.data.layout));
    const row = meta.prepare("SELECT * FROM dashboards WHERE id = ?").get(id) as DashboardRow;
    return reply.code(201).send(toDashboard(row));
  });

  app.put("/api/dashboards/:id", admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = dashboardInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues });
    const res = meta
      .prepare("UPDATE dashboards SET name = ?, layout = ?, updated_at = datetime('now') WHERE id = ?")
      .run(parsed.data.name, JSON.stringify(parsed.data.layout), id);
    if (!res.changes) return reply.code(404).send({ error: "Dashboard not found" });
    const row = meta.prepare("SELECT * FROM dashboards WHERE id = ?").get(id) as DashboardRow;
    return toDashboard(row);
  });

  app.delete("/api/dashboards/:id", admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = meta.prepare("DELETE FROM dashboards WHERE id = ?").run(id);
    return res.changes ? reply.code(204).send() : reply.code(404).send({ error: "Dashboard not found" });
  });
}
