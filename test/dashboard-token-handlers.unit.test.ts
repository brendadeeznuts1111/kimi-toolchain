import { describe, expect, test } from "bun:test";
import { DASHBOARD_COOKIE_NAMES } from "../src/lib/serve-cookies.ts";
import { apiCsrfRotate, apiCsrfVerify } from "../examples/dashboard/src/handlers/token-csrf.ts";
import { apiJwtSign, apiJwtVerify } from "../examples/dashboard/src/handlers/token-jwt.ts";

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("dashboard-token-handlers", () => {
  test("apiJwtSign rejects missing JSON body with structured domain", async () => {
    const res = await apiJwtSign(
      new Request("http://127.0.0.1/api/token/jwt/sign", { method: "POST" })
    );
    expect(res.status).toBe(400);
    const body = await readJson<{
      ok: boolean;
      domain: string;
      code: string;
      error: string;
    }>(res);
    expect(body.ok).toBe(false);
    expect(body.domain).toBe("com.kimi.toolchain.identity.jwt");
    expect(body.code).toBe("json_body_required");
    expect(body.error).toBe("JSON body required");
  });

  test("apiJwtSign and verify round-trip", async () => {
    const signRes = await apiJwtSign(
      new Request("http://127.0.0.1/api/token/jwt/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sub: "test-user", expiresIn: 60_000 }),
      })
    );
    expect(signRes.status).toBe(200);
    const signed = await readJson<{
      ok: boolean;
      token: string;
      payload?: { sid?: string };
    }>(signRes);
    expect(signed.ok).toBe(true);
    expect(signed.token.split(".")).toHaveLength(3);

    const verifyRes = await apiJwtVerify(
      new Request("http://127.0.0.1/api/token/jwt/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: signed.token }),
      })
    );
    const verified = await readJson<{
      ok: boolean;
      valid: boolean;
      sessionAligned?: boolean;
      payload?: { sid?: string };
    }>(verifyRes);
    expect(verified.valid).toBe(true);
    expect(verified.payload?.sid).toBe(signed.payload?.sid);
    expect(verified.sessionAligned).toBe(true);
  });

  test("apiJwtVerify marks malformed tokens with domain metadata", async () => {
    const res = await apiJwtVerify(
      new Request("http://127.0.0.1/api/token/jwt/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "not-a-jwt" }),
      })
    );
    const body = await readJson<{
      valid: boolean;
      domain: string;
      code: string;
    }>(res);
    expect(body.valid).toBe(false);
    expect(body.domain).toBe("com.kimi.toolchain.identity.jwt");
    expect(body.code).toBe("jwt_malformed");
  });

  test("apiJwtSign binds cookie session to sub and sid", async () => {
    const cookie = `${DASHBOARD_COOKIE_NAMES.userId}=cookie-user; ${DASHBOARD_COOKIE_NAMES.session}=cookie-sess`;
    const signRes = await apiJwtSign(
      new Request("http://127.0.0.1/api/token/jwt/sign", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ expiresIn: 60_000 }),
      })
    );
    const signed = await readJson<{
      ok: boolean;
      payload: { sub: string; sid: string };
      sessionSource: string;
    }>(signRes);
    expect(signed.payload.sub).toBe("cookie-user");
    expect(signed.payload.sid).toBe("cookie-sess");
    expect(signed.sessionSource).toBe("cookie");
  });

  test("apiCsrfRotate prefers cookie session id", async () => {
    const cookie = `${DASHBOARD_COOKIE_NAMES.session}=csrf-sess`;
    const res = await apiCsrfRotate(
      new Request("http://127.0.0.1/api/token/csrf/rotate", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({}),
      })
    );
    const body = await readJson<{ ok: boolean; sessionId: string; sessionSource: string }>(res);
    expect(body.sessionId).toBe("csrf-sess");
    expect(body.sessionSource).toBe("cookie");
  });

  test("apiCsrfVerify rejects missing token with session domain", async () => {
    const res = await apiCsrfVerify(
      new Request("http://127.0.0.1/api/token/csrf/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
    const body = await readJson<{
      ok: boolean;
      domain: string;
      code: string;
    }>(res);
    expect(body.ok).toBe(false);
    expect(body.domain).toBe("com.kimi.toolchain.identity.session");
    expect(body.code).toBe("token_required");
  });
});
