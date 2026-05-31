import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the metadata DB at a throwaway dir before importing the store.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "rptdash-auth-"));

const { authenticate, createSession, createUser, destroySession, getSessionUser, userCount } =
  await import("../src/auth/store.js");

test("password hashing round-trips and rejects wrong password", () => {
  assert.equal(userCount(), 0);
  const user = createUser("alice", "correct horse battery", "admin");
  assert.equal(user.role, "admin");
  assert.ok(authenticate("alice", "correct horse battery"));
  assert.equal(authenticate("alice", "wrong password"), undefined);
  assert.equal(authenticate("nobody", "whatever"), undefined);
});

test("sessions resolve to the user and can be destroyed", () => {
  const user = createUser("bob", "another-password", "viewer");
  const token = createSession(user.id);
  const resolved = getSessionUser(token);
  assert.equal(resolved?.username, "bob");
  assert.equal(resolved?.role, "viewer");
  destroySession(token);
  assert.equal(getSessionUser(token), undefined);
  assert.equal(getSessionUser(undefined), undefined);
});
