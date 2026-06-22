/**
 * Bun.serve CookieMap SSOT — requires `routes` mode (not plain fetch-only).
 *
 * @see https://bun.com/docs/runtime/http/cookies
 */

/** @see https://bun.com/docs/runtime/http/cookies */
export const BUN_COOKIES_DOC_URL = "https://bun.com/docs/runtime/http/cookies";

/** Dashboard session cookie names (identity-session domain). */
export const DASHBOARD_COOKIE_NAMES = {
  userId: "kimi_dashboard_user_id",
  theme: "kimi_dashboard_theme",
  session: "kimi_dashboard_session",
} as const;

export type DashboardCookieName =
  (typeof DASHBOARD_COOKIE_NAMES)[keyof typeof DASHBOARD_COOKIE_NAMES];

export const DASHBOARD_COOKIE_ROUTE_PATHS = {
  login: "/api/cookie/login",
  profile: "/api/cookie/profile",
  logout: "/api/cookie/logout",
} as const;

export const DEFAULT_DASHBOARD_COOKIE_PATH = "/";

export function requestUsesSecureTransport(req: Request): boolean {
  const url = new URL(req.url);
  if (url.protocol === "https:") return true;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return proto === "https";
}

export function defaultSessionCookieOptions(req?: Request): {
  path: string;
  httpOnly: boolean;
  sameSite: "lax";
  maxAge: number;
  secure?: boolean;
} {
  const secure = req ? requestUsesSecureTransport(req) : false;
  return {
    path: DEFAULT_DASHBOARD_COOKIE_PATH,
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    ...(secure ? { secure: true } : {}),
  };
}

export function defaultThemeCookieOptions(req?: Request): {
  path: string;
  sameSite: "lax";
  maxAge: number;
  secure?: boolean;
} {
  const secure = req ? requestUsesSecureTransport(req) : false;
  return {
    path: DEFAULT_DASHBOARD_COOKIE_PATH,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    ...(secure ? { secure: true } : {}),
  };
}

/** BunRequest exposes CookieMap when served via Bun.serve routes. */
export type BunCookieRequest = Request & {
  cookies: {
    get(name: string): string | null | undefined;
    set(name: string, value: string, options?: Record<string, unknown>): void;
    delete(name: string, options?: { path?: string }): void;
  };
};
