/**
 * GET /api/tokens — identity token endpoint discovery (JWT + CSRF).
 */

import { DASHBOARD_COOKIE_ROUTE_PATHS } from "../../../../src/lib/serve-cookies.ts";
import { jsonResponse } from "./shared.ts";

export async function apiTokensInfo(): Promise<Response> {
  return jsonResponse({
    ok: true,
    jwt: {
      sign: { method: "POST", path: "/api/token/jwt/sign" },
      verify: { method: "POST", path: "/api/token/jwt/verify" },
      revoke: { method: "POST", path: "/api/token/jwt/revoke" },
      domain: "com.kimi.toolchain.identity.jwt",
    },
    csrf: {
      rotate: { method: "POST", path: "/api/token/csrf/rotate" },
      verify: { method: "POST", path: "/api/token/csrf/verify" },
      domain: "com.kimi.toolchain.identity.session",
    },
    cookies: {
      info: { method: "GET", path: "/api/cookies" },
      login: { method: "GET|POST", path: DASHBOARD_COOKIE_ROUTE_PATHS.login },
      profile: { method: "GET", path: DASHBOARD_COOKIE_ROUTE_PATHS.profile },
      logout: { method: "GET|POST", path: DASHBOARD_COOKIE_ROUTE_PATHS.logout },
      wiredIn: "index.ts routes (req.cookies)",
    },
    flow: {
      method: "GET",
      path: "/api/identity/flow",
      action: "orchestrated cookie → JWT → CSRF probe (requires session cookies)",
    },
    sessionBinding:
      "JWT sign uses cookie user id as sub and session id as sid when Cookie header is present; CSRF rotate/verify prefer cookie session.",
  });
}
