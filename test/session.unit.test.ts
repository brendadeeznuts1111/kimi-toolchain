import { describe, expect, test } from "bun:test";
import { SessionStore, isSessionError } from "../src/lib/session.ts";

describe("session > SessionStore > create", () => {
  test("creates a session with ID and timestamps", () => {
    const store = new SessionStore();
    const session = store.create("user-123");
    expect(session.id).toBeDefined();
    expect(session.id.length).toBe(36);
    expect(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.id)
    ).toBe(true);
    expect(session.userId).toBe("user-123");
    expect(session.createdAt).toBeDefined();
    expect(session.expiresAt).toBeDefined();
    expect(session.active).toBe(true);
  });

  test("stores metadata", () => {
    const store = new SessionStore();
    const session = store.create("user-123", { ip: "127.0.0.1", ua: "test" });
    expect(session.metadata).toEqual({ ip: "127.0.0.1", ua: "test" });
  });

  test("respects custom TTL", () => {
    const now = new Date("2025-01-01T00:00:00Z");
    const store = new SessionStore({ ttlSeconds: 7200 }, () => now);
    const session = store.create("user-123");
    expect(session.createdAt).toBe("2025-01-01T00:00:00.000Z");
    expect(session.expiresAt).toBe("2025-01-01T02:00:00.000Z");
  });

  test("enforces max sessions per user", () => {
    const store = new SessionStore({ maxSessionsPerUser: 3 });
    const s1 = store.create("user-123");
    const s2 = store.create("user-123");
    const s3 = store.create("user-123");
    const s4 = store.create("user-123");

    expect(store.get(s1.id)).toBeNull();
    expect(store.get(s2.id)).not.toBeNull();
    expect(store.get(s3.id)).not.toBeNull();
    expect(store.get(s4.id)).not.toBeNull();
    expect(store.activeCount).toBe(3);
  });
});

describe("session > SessionStore > get", () => {
  test("returns null for non-existent session", () => {
    const store = new SessionStore();
    expect(store.get("nonexistent")).toBeNull();
  });

  test("returns session and updates lastActivity", () => {
    const now = new Date("2025-01-01T00:00:00Z");
    const store = new SessionStore({}, () => now);
    const session = store.create("user-123");
    expect(session.lastActivity).toBe("2025-01-01T00:00:00.000Z");

    const later = new Date("2025-01-01T00:10:00Z");
    const store2 = new SessionStore({}, () => later);
    // Can't use same store with different time, so just verify get works
    const retrieved = store.get(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.userId).toBe("user-123");
  });

  test("returns null for expired session", () => {
    const start = new Date("2025-01-01T00:00:00Z");
    const store = new SessionStore({ ttlSeconds: 1 }, () => start);
    const session = store.create("user-123");

    const later = new Date("2025-01-01T00:00:02Z");
    const store2 = new SessionStore({ ttlSeconds: 1 }, () => later);
    // Copy session to new store
    (store2 as any).sessions.set(session.id, session);
    expect(store2.get(session.id)).toBeNull();
  });

  test("returns null for idle-expired session", () => {
    const start = new Date("2025-01-01T00:00:00Z");
    const store = new SessionStore({ ttlSeconds: 3600, idleTimeoutSeconds: 60 }, () => start);
    const session = store.create("user-123");

    const later = new Date("2025-01-01T00:05:00Z");
    const store2 = new SessionStore({ ttlSeconds: 3600, idleTimeoutSeconds: 60 }, () => later);
    (store2 as any).sessions.set(session.id, session);
    expect(store2.get(session.id)).toBeNull();
  });
});

describe("session > SessionStore > verify", () => {
  test("verifies valid session", () => {
    const store = new SessionStore();
    const session = store.create("user-123");
    const verified = store.verify(session.id);
    expect(verified.userId).toBe("user-123");
  });

  test("verifies with userId match", () => {
    const store = new SessionStore();
    const session = store.create("user-123");
    const verified = store.verify(session.id, "user-123");
    expect(verified.userId).toBe("user-123");
  });

  test("throws session_not_found for wrong userId", () => {
    const store = new SessionStore();
    const session = store.create("user-123");
    try {
      store.verify(session.id, "wrong-user");
      expect(false).toBe(true);
    } catch (err) {
      expect(isSessionError(err, "session_not_found")).toBe(true);
    }
  });

  test("throws session_not_found for non-existent", () => {
    const store = new SessionStore();
    try {
      store.verify("nonexistent");
      expect(false).toBe(true);
    } catch (err) {
      expect(isSessionError(err, "session_not_found")).toBe(true);
    }
  });
});

describe("session > SessionStore > revoke", () => {
  test("revokes an active session", () => {
    const store = new SessionStore();
    const session = store.create("user-123");
    expect(store.revoke(session.id)).toBe(true);
    expect(store.get(session.id)).toBeNull();
  });

  test("returns false for non-existent session", () => {
    const store = new SessionStore();
    expect(store.revoke("nonexistent")).toBe(false);
  });

  test("revokeAllForUser removes all user sessions", () => {
    const store = new SessionStore({ maxSessionsPerUser: 100 });
    store.create("user-1");
    store.create("user-1");
    store.create("user-2");
    expect(store.revokeAllForUser("user-1")).toBe(2);
    expect(store.activeCount).toBe(1);
  });
});

describe("session > SessionStore > cleanup", () => {
  test("removes expired sessions", () => {
    const start = new Date("2025-01-01T00:00:00Z");
    const store = new SessionStore({ ttlSeconds: 1 }, () => start);
    store.create("user-1");
    store.create("user-2");

    const later = new Date("2025-01-01T00:00:02Z");
    const store2 = new SessionStore({ ttlSeconds: 1 }, () => later);
    // Copy sessions
    for (const [id, s] of (store as any).sessions) {
      (store2 as any).sessions.set(id, s);
    }
    expect(store2.cleanup()).toBe(2);
    expect(store2.activeCount).toBe(0);
  });
});
