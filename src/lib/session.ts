/**
 * session.ts — Session management with in-memory store and optional
 * SecretsManager integration for JWT signing keys.
 *
 * Features:
 *   - Create/verify/revoke sessions
 *   - Idle timeout enforcement
 *   - Max concurrent sessions per user
 *   - Session metadata (IP, user agent, etc.)
 *
 * @see jwt.ts for type definitions
 * @see jwt.ts for JWT-based session tokens
 */

import type { SessionRecord, SessionConfig, SessionError } from "./jwt.ts";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_TTL_SECONDS = 86400;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 1800;
const DEFAULT_MAX_SESSIONS = 5;

// ── SessionStore ─────────────────────────────────────────────────────

/**
 * In-memory session store. For production use, replace with a
 * persistent backend (SQLite, Redis, etc.).
 */
export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly config: Required<SessionConfig>;
  private readonly now: () => Date;

  constructor(config: SessionConfig = {}, now: () => Date = () => new Date()) {
    this.config = {
      ttlSeconds: config.ttlSeconds ?? DEFAULT_TTL_SECONDS,
      idleTimeoutSeconds: config.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_SECONDS,
      maxSessionsPerUser: config.maxSessionsPerUser ?? DEFAULT_MAX_SESSIONS,
    };
    this.now = now;
  }

  /**
   * Create a new session for a user.
   * Enforces max concurrent sessions by revoking oldest if needed.
   */
  create(userId: string, metadata?: Record<string, string>): SessionRecord {
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.config.ttlSeconds * 1000);

    const session: SessionRecord = {
      id: generateSessionId(),
      userId,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastActivity: now.toISOString(),
      metadata,
      active: true,
    };

    // Enforce max sessions
    const userSessions = this.getActiveSessionsForUser(userId);
    while (userSessions.length >= this.config.maxSessionsPerUser) {
      const oldest = userSessions.shift();
      if (oldest) {
        this.sessions.delete(oldest.id);
      }
    }

    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Get a session by ID. Returns null if not found or expired.
   * Updates lastActivity on successful retrieval.
   */
  get(sessionId: string): SessionRecord | null {
    const session = this.sessions.get(sessionId);
    if (!session || !session.active) return null;

    const now = this.now();
    const expiresAt = new Date(session.expiresAt);
    if (now >= expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    const lastActivity = new Date(session.lastActivity);
    const idleMs = now.getTime() - lastActivity.getTime();
    if (idleMs > this.config.idleTimeoutSeconds * 1000) {
      this.sessions.delete(sessionId);
      return null;
    }

    // Update last activity
    session.lastActivity = now.toISOString();
    return session;
  }

  /**
   * Verify a session is valid and belongs to the given user.
   * Throws SessionError if invalid.
   */
  verify(sessionId: string, userId?: string): SessionRecord {
    const session = this.get(sessionId);
    if (!session) {
      throw { type: "session_not_found" } as { type: SessionError };
    }
    if (userId && session.userId !== userId) {
      throw { type: "session_not_found" } as { type: SessionError };
    }
    return session;
  }

  /**
   * Revoke a session (soft delete — marks as inactive).
   */
  revoke(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.active = false;
    this.sessions.delete(sessionId);
    return true;
  }

  /**
   * Revoke all sessions for a user.
   */
  revokeAllForUser(userId: string): number {
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (session.userId === userId) {
        session.active = false;
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Get all active sessions for a user, sorted by creation time (oldest first).
   */
  getActiveSessionsForUser(userId: string): SessionRecord[] {
    const result: SessionRecord[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.active) {
        result.push(session);
      }
    }
    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Clean up expired sessions. Returns count of removed sessions.
   */
  cleanup(): number {
    const now = this.now();
    let count = 0;
    for (const [id, session] of this.sessions) {
      const expiresAt = new Date(session.expiresAt);
      if (now >= expiresAt) {
        this.sessions.delete(id);
        count++;
        continue;
      }
      const lastActivity = new Date(session.lastActivity);
      const idleMs = now.getTime() - lastActivity.getTime();
      if (idleMs > this.config.idleTimeoutSeconds * 1000) {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Get total active session count.
   */
  get activeCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.active) count++;
    }
    return count;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function generateSessionId(): string {
  return Bun.randomUUIDv7();
}

// ── Cookie Serialization (Bun.Cookie) ────────────────────────────────

/**
 * Serialize a session ID into a Set-Cookie header value using Bun.Cookie.
 *
 * @param sessionId - The session ID to set
 * @param config - Session config for TTL
 * @returns Set-Cookie header string
 */
export function sessionCookieHeader(sessionId: string, config: SessionConfig = {}): string {
  const ttlSeconds = config.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const cookie = new Bun.Cookie("session", sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: ttlSeconds,
    path: "/",
  });
  return cookie.toString();
}

/**
 * Parse a session ID from a Cookie header using Bun.CookieMap.
 *
 * @param cookieHeader - The Cookie header value
 * @returns Session ID or null if not present
 */
export function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookies = new Bun.CookieMap(cookieHeader);
  const session = cookies.get("session");
  return session ?? null;
}

/**
 * Serialize a session revocation cookie (expires immediately).
 *
 * @returns Set-Cookie header string that clears the session cookie
 */
export function clearSessionCookie(): string {
  const cookie = new Bun.Cookie("session", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 0,
    path: "/",
  });
  return cookie.toString();
}

/**
 * Check if an error is a SessionError of a specific type.
 */
export function isSessionError(err: unknown, type: SessionError): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    (err as { type: string }).type === type
  );
}
