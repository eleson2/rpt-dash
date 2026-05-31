import type { FastifyReply, FastifyRequest } from "fastify";
import { getSessionUser, type User } from "./store.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
  }
}

export const SESSION_COOKIE = "sid";

export function currentUser(req: FastifyRequest): User | undefined {
  return getSessionUser(req.cookies?.[SESSION_COOKIE]);
}

/** preHandler: require any authenticated user. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const user = currentUser(req);
  if (!user) return reply.code(401).send({ error: "Authentication required" });
  req.user = user;
}

/** preHandler: require an authenticated admin. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const user = currentUser(req);
  if (!user) return reply.code(401).send({ error: "Authentication required" });
  if (user.role !== "admin") return reply.code(403).send({ error: "Admin role required" });
  req.user = user;
}
