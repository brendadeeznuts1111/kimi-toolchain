import { describe, expect, test } from "bun:test";
import {
  apiCookieLogin,
  apiCookieLogout,
  apiCookieProfile,
} from "../examples/dashboard/src/handlers/token-cookies.ts";
import { DASHBOARD_COOKIE_NAMES, DASHBOARD_COOKIE_ROUTE_PATHS } from "../src/lib/serve-cookies.ts";
import { resolveIdentityContext } from "../src/lib/serve-session.ts";

function cookieHeaderFromResponse(res: Response): string {
  const many = res.headers.getSetCookie?.();
  if (many && many.length > 0) return many.join("; ");
  return res.headers.get("set-cookie") ?? "";
}

describe("serve-cookies", () => {
  test("resolveIdentityContext uses Cookie header under development fetch dispatch", async () => {
    const server = Bun.serve({
      port: 0,
      development: true,
      async fetch(req) {
        const ctx = resolveIdentityContext(req);
        expect(ctx.authenticated).toBe(false);
        return Response.json({ ok: true });
      },
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/probe`);
      expect(res.status).toBe(200);
    } finally {
      server.stop(true);
    }
  });

  test("login sets cookies and profile reads them", async () => {
    const server = Bun.serve({
      port: 0,
      routes: {
        [DASHBOARD_COOKIE_ROUTE_PATHS.login]: apiCookieLogin,
        [DASHBOARD_COOKIE_ROUTE_PATHS.profile]: apiCookieProfile,
        [DASHBOARD_COOKIE_ROUTE_PATHS.logout]: apiCookieLogout,
      },
    });

    try {
      const login = await fetch(
        `http://127.0.0.1:${server.port}${DASHBOARD_COOKIE_ROUTE_PATHS.login}?theme=dark`,
        {
          method: "POST",
        }
      );
      expect(login.status).toBe(200);
      const loginBody = await login.json();
      expect(loginBody.ok).toBe(true);
      expect(loginBody.theme).toBe("dark");

      const cookie = cookieHeaderFromResponse(login);
      expect(cookie).toContain(`${DASHBOARD_COOKIE_NAMES.userId}=`);
      expect(cookie).toContain(`${DASHBOARD_COOKIE_NAMES.theme}=dark`);

      const profile = await fetch(
        `http://127.0.0.1:${server.port}${DASHBOARD_COOKIE_ROUTE_PATHS.profile}`,
        {
          headers: { cookie },
        }
      );
      const profileBody = await profile.json();
      expect(profileBody.authenticated).toBe(true);
      expect(profileBody.userId).toBe(loginBody.userId);
      expect(profileBody.theme).toBe("dark");
    } finally {
      server.stop(true);
    }
  });

  test("logout clears session cookies", async () => {
    const server = Bun.serve({
      port: 0,
      routes: {
        [DASHBOARD_COOKIE_ROUTE_PATHS.login]: apiCookieLogin,
        [DASHBOARD_COOKIE_ROUTE_PATHS.profile]: apiCookieProfile,
        [DASHBOARD_COOKIE_ROUTE_PATHS.logout]: apiCookieLogout,
      },
    });

    try {
      const login = await fetch(
        `http://127.0.0.1:${server.port}${DASHBOARD_COOKIE_ROUTE_PATHS.login}`
      );
      const cookie = cookieHeaderFromResponse(login);

      const logout = await fetch(
        `http://127.0.0.1:${server.port}${DASHBOARD_COOKIE_ROUTE_PATHS.logout}`,
        {
          headers: { cookie },
        }
      );
      expect((await logout.json()).ok).toBe(true);

      const profile = await fetch(
        `http://127.0.0.1:${server.port}${DASHBOARD_COOKIE_ROUTE_PATHS.profile}`
      );
      const profileBody = await profile.json();
      expect(profileBody.authenticated).toBe(false);
      expect(profileBody.userId).toBeNull();
    } finally {
      server.stop(true);
    }
  });
});
