import { describe, expect, test } from "bun:test";
import { DASHBOARD_COOKIE_NAMES, DASHBOARD_COOKIE_ROUTE_PATHS } from "../src/lib/serve-cookies.ts";
import {
  apiCookieLogin,
  apiCookieProfile,
} from "../examples/dashboard/src/handlers/token-cookies.ts";
import { apiIdentityFlow } from "../examples/dashboard/src/handlers/identity-flow.ts";

function cookieHeaderFromResponse(res: Response): string {
  const many = res.headers.getSetCookie?.();
  if (many && many.length > 0) return many.join("; ");
  return res.headers.get("set-cookie") ?? "";
}

describe("identity-flow", () => {
  test("apiIdentityFlow skips jwt/csrf without session cookies", async () => {
    const res = await apiIdentityFlow(new Request("http://127.0.0.1/api/identity/flow"));
    const body = (await res.json()) as {
      authenticated: boolean;
      steps: Array<{ id: string; status: string }>;
    };
    expect(body.authenticated).toBe(false);
    expect(body.steps.find((s) => s.id === "jwt")?.status).toBe("skip");
    expect(body.steps.find((s) => s.id === "csrf")?.status).toBe("skip");
  });

  test("apiIdentityFlow runs full pipeline with cookie session", async () => {
    const server = Bun.serve({
      port: 0,
      routes: {
        [DASHBOARD_COOKIE_ROUTE_PATHS.login]: apiCookieLogin,
        [DASHBOARD_COOKIE_ROUTE_PATHS.profile]: apiCookieProfile,
      },
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/identity/flow") return apiIdentityFlow(req);
        if (url.pathname === "/api/token/jwt/sign") {
          const { apiJwtSign } = await import("../examples/dashboard/src/handlers/token-jwt.ts");
          return apiJwtSign(req);
        }
        if (url.pathname === "/api/token/jwt/verify") {
          const { apiJwtVerify } = await import("../examples/dashboard/src/handlers/token-jwt.ts");
          return apiJwtVerify(req);
        }
        if (url.pathname === "/api/token/csrf/rotate") {
          const { apiCsrfRotate } =
            await import("../examples/dashboard/src/handlers/token-csrf.ts");
          return apiCsrfRotate(req);
        }
        if (url.pathname === "/api/token/csrf/verify") {
          const { apiCsrfVerify } =
            await import("../examples/dashboard/src/handlers/token-csrf.ts");
          return apiCsrfVerify(req);
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const login = await fetch(
        `http://127.0.0.1:${server.port}${DASHBOARD_COOKIE_ROUTE_PATHS.login}`,
        {
          method: "POST",
        }
      );
      const cookie = cookieHeaderFromResponse(login);

      const flow = await fetch(`http://127.0.0.1:${server.port}/api/identity/flow`, {
        headers: { cookie },
      });
      const body = (await flow.json()) as {
        ok: boolean;
        authenticated: boolean;
        steps: Array<{ id: string; status: string; detail: Record<string, unknown> }>;
      };

      expect(body.authenticated).toBe(true);
      expect(body.steps.find((s) => s.id === "session")?.status).toBe("ok");
      expect(body.steps.find((s) => s.id === "jwt")?.status).toBe("ok");
      expect(body.steps.find((s) => s.id === "csrf")?.status).toBe("ok");
      expect(body.steps.find((s) => s.id === "jwt")?.detail.valid).toBe(true);
      expect(body.steps.find((s) => s.id === "csrf")?.detail.valid).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("resolveIdentityContext reads paired session cookies", async () => {
    const { resolveIdentityContext } = await import("../src/lib/serve-session.ts");
    const req = new Request("http://127.0.0.1/api/identity/flow", {
      headers: {
        cookie: `${DASHBOARD_COOKIE_NAMES.userId}=u1; ${DASHBOARD_COOKIE_NAMES.session}=s1; ${DASHBOARD_COOKIE_NAMES.theme}=dark`,
      },
    });
    const ctx = resolveIdentityContext(req);
    expect(ctx.authenticated).toBe(true);
    expect(ctx.userId).toBe("u1");
    expect(ctx.sessionId).toBe("s1");
    expect(ctx.theme).toBe("dark");
  });
});
