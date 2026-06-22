/**
 * Cookie session handlers — Bun.serve `routes` + req.cookies CookieMap.
 *
 * Wired in examples/dashboard/src/index.ts `routes` (auto Set-Cookie on response).
 *
 * @see https://bun.com/docs/runtime/http/cookies
 */

import {
  DASHBOARD_COOKIE_NAMES,
  DASHBOARD_COOKIE_ROUTE_PATHS,
  defaultSessionCookieOptions,
  defaultThemeCookieOptions,
  type BunCookieRequest,
} from "../../../../src/lib/serve-cookies.ts";
import { structuredErrorFields } from "../../../../src/lib/error-format.ts";

const COOKIE_DOMAIN = "identity-session" as const;

function readThemeParam(req: BunCookieRequest): string {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("theme")?.trim();
  if (fromQuery === "light" || fromQuery === "dark") return fromQuery;
  const fromHeader = req.headers.get("x-theme")?.trim();
  if (fromHeader === "light" || fromHeader === "dark") return fromHeader;
  return "dark";
}

/** POST/GET /api/cookie/login — set session + theme cookies. */
export function apiCookieLogin(req: BunCookieRequest): Response {
  const theme = readThemeParam(req);
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  req.cookies.set(DASHBOARD_COOKIE_NAMES.userId, userId, defaultSessionCookieOptions(req));
  req.cookies.set(DASHBOARD_COOKIE_NAMES.session, sessionId, defaultSessionCookieOptions(req));
  req.cookies.set(DASHBOARD_COOKIE_NAMES.theme, theme, defaultThemeCookieOptions(req));

  return Response.json({
    ok: true,
    message: "Login successful",
    userId,
    sessionId,
    theme,
    ...structuredErrorFields({
      domain: COOKIE_DOMAIN,
      code: "cookie_login",
      message: "Session cookies set",
      severity: "info",
    }),
    note: "Set-Cookie applied automatically by Bun.serve routes when req.cookies.set is used.",
  });
}

/** GET /api/cookie/profile — read cookies from the incoming request. */
export function apiCookieProfile(req: BunCookieRequest): Response {
  const userId = req.cookies.get(DASHBOARD_COOKIE_NAMES.userId) || null;
  const sessionId = req.cookies.get(DASHBOARD_COOKIE_NAMES.session) || null;
  const theme = req.cookies.get(DASHBOARD_COOKIE_NAMES.theme) ?? "light";

  return Response.json({
    ok: true,
    authenticated: Boolean(userId),
    userId: userId ?? null,
    sessionId: sessionId ?? null,
    theme,
    domain: "com.kimi.toolchain.identity.session",
    note: "Values read via req.cookies.get on BunRequest (Bun.serve routes).",
  });
}

/** POST/GET /api/cookie/logout — delete session cookies. */
export function apiCookieLogout(req: BunCookieRequest): Response {
  const path = defaultSessionCookieOptions(req).path;
  req.cookies.delete(DASHBOARD_COOKIE_NAMES.userId, { path });
  req.cookies.delete(DASHBOARD_COOKIE_NAMES.session, { path });

  return Response.json({
    ok: true,
    message: "Logged out successfully",
    cleared: [DASHBOARD_COOKIE_NAMES.userId, DASHBOARD_COOKIE_NAMES.session],
    ...structuredErrorFields({
      domain: COOKIE_DOMAIN,
      code: "cookie_logout",
      message: "Session cookies deleted",
      severity: "info",
    }),
    note: "req.cookies.delete emits Set-Cookie with maxAge=0.",
  });
}

/** GET /api/cookies — discover cookie demo routes (fetch dispatch; read-only). */
export async function apiCookiesInfo(): Promise<Response> {
  return Response.json({
    ok: true,
    doc: "https://bun.com/docs/runtime/http/cookies",
    routesMode: true,
    names: DASHBOARD_COOKIE_NAMES,
    endpoints: [
      {
        method: "GET|POST",
        path: DASHBOARD_COOKIE_ROUTE_PATHS.login,
        action: "set session cookies",
      },
      { method: "GET", path: DASHBOARD_COOKIE_ROUTE_PATHS.profile, action: "read cookies" },
      {
        method: "GET|POST",
        path: DASHBOARD_COOKIE_ROUTE_PATHS.logout,
        action: "delete session cookies",
      },
    ],
    note: "Cookie mutations use Bun.serve routes in index.ts — req.cookies auto-applies Set-Cookie.",
  });
}
