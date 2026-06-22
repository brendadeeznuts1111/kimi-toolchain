import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Effect } from "effect";
import { Identity, IdentityTest } from "../src/lib/effect/identity-service.ts";
import type { IdentityService } from "../src/lib/effect/identity-service.ts";
import { createIdentityServer } from "../examples/identity-usage-example.ts";

const TEST_JWT_SECRET = "test-jwt-secret";
const TEST_CSRF_SECRET = "test-csrf-secret";
const TEST_PASSWORD = "test-password-123";

const layer = IdentityTest({
  jwtSecret: TEST_JWT_SECRET,
  csrfSecret: TEST_CSRF_SECRET,
});

let identity: IdentityService;
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let passwordHash: string;

beforeAll(async () => {
  identity = await Effect.runPromise(
    Effect.provide(layer)(
      Effect.gen(function* () {
        return yield* Identity;
      })
    )
  );

  passwordHash = await Effect.runPromise(
    Effect.provide(layer)(
      Effect.gen(function* () {
        const id = yield* Identity;
        return yield* id.hashPassword(TEST_PASSWORD);
      })
    )
  );

  const handler = createIdentityServer(identity, passwordHash);
  server = Bun.serve({ port: 0, fetch: handler });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop();
});

async function parseSetCookie(res: Response): Promise<string | null> {
  const cookie = res.headers.get("Set-Cookie");
  if (!cookie) return null;
  const match = cookie.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

async function login(
  username: string = "demo-user",
  password: string = TEST_PASSWORD
): Promise<{ res: Response; sessionId: string | null; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  const sessionId = await parseSetCookie(res);
  return { res, sessionId, body };
}

describe("identity-usage-example > POST /login", () => {
  test("succeeds with correct password", async () => {
    const { res, sessionId, body } = await login();
    expect(res.status).toBe(200);
    expect(body.userId).toBe("demo-user");
    expect(body.csrfToken).toBeDefined();
    expect(sessionId).not.toBeNull();
  });

  test("fails with wrong password", async () => {
    const { res, body } = await login("demo-user", "wrong-password");
    expect(res.status).toBe(401);
    expect(body.error).toBe("Invalid credentials");
  });
});

describe("identity-usage-example > GET /me", () => {
  test("returns user info with valid session cookie", async () => {
    const { sessionId } = await login();
    const res = await fetch(`${baseUrl}/me`, {
      headers: { Cookie: `session=${sessionId}` },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.userId).toBe("demo-user");
    expect(body.sessionId).toBe(sessionId);
  });

  test("returns 401 without session cookie", async () => {
    const res = await fetch(`${baseUrl}/me`);
    expect(res.status).toBe(401);
  });

  test("returns 401 with invalid session cookie", async () => {
    const res = await fetch(`${baseUrl}/me`, {
      headers: { Cookie: "session=nonexistent" },
    });
    expect(res.status).toBe(401);
  });
});

describe("identity-usage-example > POST /data", () => {
  test("succeeds with auth + valid CSRF token", async () => {
    const { sessionId, body: loginBody } = await login();
    const csrfToken = loginBody.csrfToken as string;
    const res = await fetch(`${baseUrl}/data`, {
      method: "POST",
      headers: {
        Cookie: `session=${sessionId}`,
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: "hello" }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.value).toBe("hello");
  });

  test("fails with 403 when CSRF token missing", async () => {
    const { sessionId } = await login();
    const res = await fetch(`${baseUrl}/data`, {
      method: "POST",
      headers: {
        Cookie: `session=${sessionId}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: "hello" }),
    });
    expect(res.status).toBe(403);
  });

  test("fails with 403 when CSRF token wrong", async () => {
    const { sessionId } = await login();
    const res = await fetch(`${baseUrl}/data`, {
      method: "POST",
      headers: {
        Cookie: `session=${sessionId}`,
        "X-CSRF-Token": "wrong-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: "hello" }),
    });
    expect(res.status).toBe(403);
  });

  test("fails with 401 without auth", async () => {
    const res = await fetch(`${baseUrl}/data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "hello" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("identity-usage-example > GET /token", () => {
  test("issues JWT for authenticated session", async () => {
    const { sessionId } = await login();
    const res = await fetch(`${baseUrl}/token`, {
      headers: { Cookie: `session=${sessionId}` },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.token).toBeDefined();
    expect((body.token as string).split(".")).toHaveLength(3);
  });

  test("returns 401 without auth", async () => {
    const res = await fetch(`${baseUrl}/token`);
    expect(res.status).toBe(401);
  });
});

describe("identity-usage-example > POST /logout", () => {
  test("revokes session and clears cookie", async () => {
    const { sessionId } = await login();
    const res = await fetch(`${baseUrl}/logout`, {
      method: "POST",
      headers: { Cookie: `session=${sessionId}` },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");

    // Session should no longer work
    const meRes = await fetch(`${baseUrl}/me`, {
      headers: { Cookie: `session=${sessionId}` },
    });
    expect(meRes.status).toBe(401);
  });
});
