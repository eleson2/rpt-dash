import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  authenticate,
  createSession,
  createUser,
  destroySession,
  getUserByName,
  listUsers,
  userCount,
} from "./store.js";
import { SESSION_COOKIE, currentUser, requireAdmin } from "./guards.js";

const credsSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(256),
});

const registerSchema = credsSchema.extend({
  role: z.enum(["admin", "viewer"]).optional(),
});

// Login allows an empty password: passwordless accounts sign in on username
// alone. The password is still verified for accounts that have one.
const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().max(256).default(""),
});

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60, // seconds
};

export async function authRoutes(app: FastifyInstance) {
  app.get("/api/auth/me", async (req) => {
    const user = currentUser(req);
    // needsBootstrap tells the SPA to show first-admin setup instead of login.
    return { user: user ?? null, needsBootstrap: userCount() === 0 };
  });

  // Create a user. When no users exist yet, anyone may create the first admin
  // (bootstrap). Afterwards, only an admin may create users.
  app.post("/api/auth/register", async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues });
    }
    const bootstrap = userCount() === 0;
    if (!bootstrap) {
      const admin = currentUser(req);
      if (!admin || admin.role !== "admin") {
        return reply.code(403).send({ error: "Admin role required to add users" });
      }
    }
    if (getUserByName(parsed.data.username)) {
      return reply.code(409).send({ error: "Username already taken" });
    }
    const role = bootstrap ? "admin" : parsed.data.role ?? "viewer";
    const user = createUser(parsed.data.username, parsed.data.password, role);

    if (bootstrap) {
      // Log the first admin straight in.
      const token = createSession(user.id);
      reply.setCookie(SESSION_COOKIE, token, cookieOpts);
    }
    return reply.code(201).send({ user });
  });

  app.post("/api/auth/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid credentials" });
    const user = authenticate(parsed.data.username, parsed.data.password);
    if (!user) return reply.code(401).send({ error: "Invalid username or password" });
    const token = createSession(user.id);
    reply.setCookie(SESSION_COOKIE, token, cookieOpts);
    return { user };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    destroySession(req.cookies?.[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  // Admin-only user listing.
  app.get("/api/auth/users", { preHandler: requireAdmin }, async () => ({ users: listUsers() }));
}
