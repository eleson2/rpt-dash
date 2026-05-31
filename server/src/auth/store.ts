import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import { meta } from "../db/metadata.js";

export type Role = "admin" | "viewer";

export interface User {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  created_at: string;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// --- password hashing (Node scrypt; no native dependency) ---

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const derived = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function toUser(r: UserRow): User {
  return { id: r.id, username: r.username, role: r.role, createdAt: r.created_at };
}

// --- users ---

export function userCount(): number {
  return (meta.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n;
}

export function getUserByName(username: string): UserRow | undefined {
  return meta.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
}

export function createUser(username: string, password: string, role: Role): User {
  const id = nanoid(12);
  meta
    .prepare("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)")
    .run(id, username, hashPassword(password), role);
  return toUser(meta.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow);
}

export function listUsers(): User[] {
  const rows = meta.prepare("SELECT * FROM users ORDER BY username").all() as UserRow[];
  return rows.map(toUser);
}

/** Verify credentials; returns the user on success, undefined otherwise. */
export function authenticate(username: string, password: string): User | undefined {
  const row = getUserByName(username);
  if (!row || !verifyPassword(password, row.password_hash)) return undefined;
  return toUser(row);
}

// --- sessions ---

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("hex");
  meta
    .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .run(token, userId, Date.now() + SESSION_TTL_MS);
  return token;
}

export function getSessionUser(token: string | undefined): User | undefined {
  if (!token) return undefined;
  const row = meta
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, Date.now()) as UserRow | undefined;
  return row ? toUser(row) : undefined;
}

export function destroySession(token: string | undefined): void {
  if (token) meta.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

/** Remove expired sessions. */
export function pruneSessions(): void {
  meta.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}
