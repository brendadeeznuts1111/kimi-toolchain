/**
 * Session identity resolution — cookie header + Bun.serve routes CookieMap.
 */

import { DASHBOARD_COOKIE_NAMES } from "./serve-cookies.ts";

export type SessionSource = "cookie" | "header" | "demo" | "body";

export interface IdentityContext {
  authenticated: boolean;
  userId: string | null;
  sessionId: string | null;
  theme: string | null;
  source: SessionSource | null;
}

function parseCookieHeader(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) map.set(name, value);
  }
  return map;
}

function sessionFromCookieMap(read: (name: string) => string | undefined): string | null {
  const session = read(DASHBOARD_COOKIE_NAMES.session)?.trim();
  if (session) return session;
  const userId = read(DASHBOARD_COOKIE_NAMES.userId)?.trim();
  if (userId) return userId;
  return null;
}

/** Resolve session id for CSRF/JWT binding — prefers dashboard session cookies. */
export function resolveSessionIdFromRequest(req: Request): {
  sessionId: string;
  source: SessionSource;
} {
  const parsed = parseCookieHeader(req.headers?.get?.("cookie") ?? null);
  const fromHeader = sessionFromCookieMap((name) => parsed.get(name));
  if (fromHeader) return { sessionId: fromHeader, source: "cookie" };

  const header = req.headers?.get?.("x-session-id");
  if (header?.trim()) return { sessionId: header.trim(), source: "header" };

  const ip = req.headers.get("x-forwarded-for") ?? "127.0.0.1";
  return { sessionId: `demo-${ip.replace(/[^a-zA-Z0-9]/g, "-")}`, source: "demo" };
}

function readCookieValue(req: Request, name: string): string | null {
  const cookieHeader = req.headers?.get?.("cookie") ?? null;
  const parsed = parseCookieHeader(cookieHeader);
  return parsed.get(name)?.trim() ?? null;
}

/** Dashboard user id from session cookies when present. */
export function resolveUserIdFromRequest(req: Request): string | null {
  return readCookieValue(req, DASHBOARD_COOKIE_NAMES.userId);
}

/** Full identity context from dashboard session cookies. */
export function resolveIdentityContext(req: Request): IdentityContext {
  const userId = readCookieValue(req, DASHBOARD_COOKIE_NAMES.userId);
  const sessionId = readCookieValue(req, DASHBOARD_COOKIE_NAMES.session);
  const theme = readCookieValue(req, DASHBOARD_COOKIE_NAMES.theme);
  const authenticated = Boolean(userId && sessionId);

  return {
    authenticated,
    userId,
    sessionId,
    theme,
    source: authenticated ? "cookie" : null,
  };
}

/** Clone a sub-request preserving session cookies for internal handler calls. */
export function forwardSessionRequest(
  req: Request,
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Request {
  const url = new URL(req.url);
  url.pathname = path;
  const headers = new Headers(init.headers);
  const cookie = req.headers.get("cookie");
  if (cookie && !headers.has("cookie")) headers.set("cookie", cookie);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(url.toString(), {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });
}
