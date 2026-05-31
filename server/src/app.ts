import { fileURLToPath } from "node:url";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import "./db/metadata.js"; // initialize schema on startup
import { authRoutes } from "./auth/routes.js";
import { createUser, getUserByName, pruneSessions, userCount } from "./auth/store.js";
import { datasetRoutes } from "./routes/datasets.js";
import { metricRoutes } from "./routes/metrics.js";
import { dashboardRoutes } from "./routes/dashboards.js";

/** Seed an admin from env on first run (no users yet), for headless deploys. */
function bootstrapAdminFromEnv() {
  const username = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  if (username && password && userCount() === 0 && !getUserByName(username)) {
    createUser(username, password, "admin");
    return username;
  }
  return null;
}

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  // credentials:true so the SPA can send the session cookie cross-origin in dev.
  await app.register(cors, { origin: config.corsOrigin, credentials: true });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GiB
  });

  pruneSessions();
  const seeded = bootstrapAdminFromEnv();
  if (seeded) app.log.info(`Seeded admin user "${seeded}" from environment.`);

  app.get("/api/health", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(datasetRoutes);
  await app.register(metricRoutes);
  await app.register(dashboardRoutes);

  // In production, optionally serve the built SPA from a single process.
  // Set WEB_DIST to the web/dist directory (the Docker image does this).
  // @fastify/static requires an absolute root.
  const webDist = process.env.WEB_DIST ? resolve(process.env.WEB_DIST) : undefined;
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
