import { fileURLToPath } from "node:url";
import { existsSync, realpathSync } from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import "./db/metadata.js"; // initialize schema on startup
import { datasetRoutes } from "./routes/datasets.js";
import { metricRoutes } from "./routes/metrics.js";
import { dashboardRoutes } from "./routes/dashboards.js";

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(multipart, {
    limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GiB
  });

  app.get("/api/health", async () => ({ ok: true }));

  await app.register(datasetRoutes);
  await app.register(metricRoutes);
  await app.register(dashboardRoutes);

  // In production, optionally serve the built SPA from a single process.
  // Set WEB_DIST to the web/dist directory (the Docker image does this).
  const webDist = process.env.WEB_DIST;
  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    // SPA fallback: serve index.html for non-API GET routes.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
  }

  return app;
}

// Start the server unless imported (e.g. by a test).
const entry = process.argv[1] ? realpathSync(process.argv[1]) : "";
const isMain = entry === fileURLToPath(import.meta.url);
if (isMain) {
  const app = await buildApp();
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
