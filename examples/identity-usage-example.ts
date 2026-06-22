/**
 * identity-usage-example.ts — Example Bun.serve routes using the Identity service.
 *
 * Shows how to wire JWT auth middleware, CSRF protection, and session cookies
 * together in a real HTTP server using the Effect-based IdentityService.
 *
 * Run standalone:  bun run src/lib/identity-usage-example.ts
 * Run tests:       bun test test/identity-usage-example.unit.test.ts
 */

import { Effect, Either, Exit } from "effect";
import { Identity, IdentityTest } from "../src/lib/effect/identity-service.ts";
import type { IdentityService } from "../src/lib/effect/identity-service.ts";

// ── Types ────────────────────────────────────────────────────────────

export interface AuthContext {
  userId: string;
  sessionId: string;
}

// ── Middleware ───────────────────────────────────────────────────────

/**
 * Extract session ID from request cookies using the Identity service.
 */
export function extractSessionId(req: Request, identity: IdentityService): string | null {
  const cookieHeader = req.headers.get("Cookie");
  return identity.parseSessionCookie(cookieHeader);
}

/**
 * Verify the session and extract the auth context.
 * Returns null if not authenticated.
 */
export async function requireAuth(
  req: Request,
  identity: IdentityService
): Promise<AuthContext | null> {
  const sessionId = extractSessionId(req, identity);
  if (!sessionId) return null;

  const either = await Effect.runPromise(Effect.either(identity.verifySession(sessionId)));

  if (Either.isLeft(either)) return null;
  return { userId: either.right.userId, sessionId };
}

/**
 * Check if the CSRF token in `X-CSRF-Token` header is valid for the session.
 * Returns true on success, false on any failure (missing token, invalid, expired).
 */
export async function verifyCsrf(
  req: Request,
  identity: IdentityService,
  sessionId: string
): Promise<boolean> {
  const token = req.headers.get("X-CSRF-Token");
  if (!token) return false;
  const exit = await Effect.runPromiseExit(identity.verifyCsrf(token, sessionId));
  return Exit.isSuccess(exit);
}

/**
 * CSRF guard for state-changing requests.
 * Returns a 403 `Response` when the token is missing or invalid, `null` when it passes.
 * Use before any handler that mutates state:
 *
 * ```ts
 * const guard = await requireCsrf(req, identity, sessionId);
 * if (guard) return guard;
 * ```
 */
export async function requireCsrf(
  req: Request,
  identity: IdentityService,
  sessionId: string
): Promise<Response | null> {
  const token = req.headers.get("X-CSRF-Token");
  if (!token) {
    return Response.json({ error: "CSRF token missing" }, { status: 403 });
  }
  const exit = await Effect.runPromiseExit(identity.verifyCsrf(token, sessionId));
  if (Exit.isFailure(exit)) {
    return Response.json({ error: "CSRF token invalid" }, { status: 403 });
  }
  return null;
}

// ── Route Handlers ───────────────────────────────────────────────────

/**
 * POST /login — Authenticate, create session, set cookie, return CSRF token.
 */
export async function handleLogin(
  req: Request,
  identity: IdentityService,
  passwordHash: string
): Promise<Response> {
  const body = (await (req as any).json()) as { username: string; password: string };

  const valid = await Effect.runPromise(identity.verifyPassword(body.password, passwordHash));
  if (!valid) {
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const session = await Effect.runPromise(
    identity.createSession(body.username, {
      ip: req.headers.get("X-Forwarded-For") ?? "unknown",
      ua: req.headers.get("User-Agent") ?? "unknown",
    })
  );

  const cookie = identity.sessionCookie(session.id);
  const csrfToken = await Effect.runPromise(identity.generateCsrf(session.id));

  return Response.json(
    { userId: session.userId, csrfToken },
    { status: 200, headers: { "Set-Cookie": cookie } }
  );
}

/**
 * POST /logout — Revoke session, clear cookie.
 */
export async function handleLogout(req: Request, identity: IdentityService): Promise<Response> {
  const sessionId = extractSessionId(req, identity);
  if (sessionId) {
    await Effect.runPromise(identity.revokeSession(sessionId));
  }
  return Response.json(
    { ok: true },
    { status: 200, headers: { "Set-Cookie": identity.clearSessionCookie() } }
  );
}

/**
 * GET /me — Get current user info (requires auth).
 */
export async function handleMe(req: Request, identity: IdentityService): Promise<Response> {
  const ctx = await requireAuth(req, identity);
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ userId: ctx.userId, sessionId: ctx.sessionId });
}

/**
 * POST /data — Protected endpoint (requires auth + CSRF).
 */
export async function handlePostData(req: Request, identity: IdentityService): Promise<Response> {
  const ctx = await requireAuth(req, identity);
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const csrfGuard = await requireCsrf(req, identity, ctx.sessionId);
  if (csrfGuard) return csrfGuard;

  const body = (await (req as any).json()) as { value: string };
  return Response.json({ ok: true, userId: ctx.userId, value: body.value });
}

/**
 * GET /token — Issue a JWT for the authenticated session.
 */
export async function handleGetToken(req: Request, identity: IdentityService): Promise<Response> {
  const ctx = await requireAuth(req, identity);
  if (!ctx) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await Effect.runPromise(
    identity.signToken({ sub: ctx.userId, sessionId: ctx.sessionId })
  );

  return Response.json({ token });
}

// ── Server Factory ───────────────────────────────────────────────────

/**
 * Create a Bun.serve fetch handler wired with the Identity service.
 */
export function createIdentityServer(
  identity: IdentityService,
  passwordHash: string
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    if (method === "POST" && url.pathname === "/login") {
      return handleLogin(req, identity, passwordHash);
    }
    if (method === "POST" && url.pathname === "/logout") {
      return handleLogout(req, identity);
    }
    if (method === "GET" && url.pathname === "/me") {
      return handleMe(req, identity);
    }
    if (method === "POST" && url.pathname === "/data") {
      return handlePostData(req, identity);
    }
    if (method === "GET" && url.pathname === "/token") {
      return handleGetToken(req, identity);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  };
}

// ── Standalone Server (bun run) ──────────────────────────────────────

if (import.meta.main) {
  const layer = IdentityTest({
    jwtSecret: "demo-jwt-secret",
    csrfSecret: "demo-csrf-secret",
  });

  const identity = await Effect.runPromise(
    Effect.provide(layer)(
      Effect.gen(function* () {
        return yield* Identity;
      })
    )
  );

  const demoHash = await Effect.runPromise(
    Effect.provide(layer)(
      Effect.gen(function* () {
        const id = yield* Identity;
        return yield* id.hashPassword("demo-password");
      })
    )
  );

  const handler = createIdentityServer(identity, demoHash);
  const server = Bun.serve({
    port: 3000,
    fetch: handler,
  });
  console.log(`Identity example server running on http://localhost:${server.port}`);
  console.log('Try: POST /login with {"username":"demo","password":"demo-password"}');
}
