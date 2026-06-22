import { describe, expect, test } from "bun:test";
import { DASHBOARD_COOKIE_NAMES } from "../src/lib/serve-cookies.ts";
import {
  resolveIdentityContext,
  resolveSessionIdFromRequest,
  resolveUserIdFromRequest,
} from "../src/lib/serve-session.ts";

describe("serve-session", () => {
  test("resolveSessionIdFromRequest reads session cookie from Cookie header", () => {
    const req = new Request("http://127.0.0.1/api/token/csrf/rotate", {
      headers: {
        cookie: `${DASHBOARD_COOKIE_NAMES.session}=sess-abc; ${DASHBOARD_COOKIE_NAMES.theme}=dark`,
      },
    });
    const resolved = resolveSessionIdFromRequest(req);
    expect(resolved.sessionId).toBe("sess-abc");
    expect(resolved.source).toBe("cookie");
  });

  test("resolveUserIdFromRequest prefers user id cookie", () => {
    const req = new Request("http://127.0.0.1/api/token/jwt/sign", {
      headers: {
        cookie: `${DASHBOARD_COOKIE_NAMES.userId}=user-42`,
      },
    });
    expect(resolveUserIdFromRequest(req)).toBe("user-42");
  });

  test("resolveIdentityContext requires both user and session cookies", () => {
    const partial = new Request("http://127.0.0.1/", {
      headers: { cookie: `${DASHBOARD_COOKIE_NAMES.userId}=only-user` },
    });
    expect(resolveIdentityContext(partial).authenticated).toBe(false);

    const full = new Request("http://127.0.0.1/", {
      headers: {
        cookie: `${DASHBOARD_COOKIE_NAMES.userId}=u; ${DASHBOARD_COOKIE_NAMES.session}=s`,
      },
    });
    const ctx = resolveIdentityContext(full);
    expect(ctx.authenticated).toBe(true);
    expect(ctx.source).toBe("cookie");
  });

  test("resolveSessionIdFromRequest falls back to x-session-id", () => {
    const req = new Request("http://127.0.0.1/api/token/csrf/rotate", {
      headers: { "x-session-id": "header-session" },
    });
    const resolved = resolveSessionIdFromRequest(req);
    expect(resolved.sessionId).toBe("header-session");
    expect(resolved.source).toBe("header");
  });
});
