/**
 * Token auth + time-based scheduling — setSystemTime pattern from Bun mock-clock guide.
 *
 * Maps sports-terminal-style signToken/verifyToken to src/lib/jwt.ts (signJwt/verifyJwt).
 *
 * @see https://bun.com/guides/test/mock-clock
 * @see test/helpers/mock-clock.ts
 */

import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { VerifiedJwt } from "../src/lib/jwt.ts";
import { signJwt, verifyJwt } from "../src/lib/jwt.ts";

const LAYER_SECRET = "test-token-auth-layer-secret";

function signToken(
  claims: { sub: string; domain?: string },
  secret: string,
  ttlSeconds: number
): string {
  return signJwt({ sub: claims.sub, aud: claims.domain }, secret, {
    ttlSeconds,
    audience: claims.domain,
  });
}

/** Example-style API: null when expired, otherwise verified payload. */
function verifyToken(token: string, secret: string): VerifiedJwt | null {
  try {
    return verifyJwt(token, secret);
  } catch (error) {
    if ((error as { type?: string })?.type === "jwt_expired") return null;
    throw error;
  }
}

describe("token-auth", () => {
  afterEach(() => {
    setSystemTime(); // reset to actual time
  });

  test("token expires after TTL", () => {
    const issueDate = new Date("2026-06-23T00:00:00.000Z");
    setSystemTime(issueDate);

    const token = signToken({ sub: "test", domain: "sports-terminal" }, LAYER_SECRET, 3600);

    expect(verifyToken(token, LAYER_SECRET)).toBeTruthy();
    expect(verifyToken(token, LAYER_SECRET)?.claims.sub).toBe("test");

    setSystemTime(new Date("2026-06-23T00:59:59.000Z"));
    expect(verifyToken(token, LAYER_SECRET)).toBeTruthy();

    setSystemTime(new Date("2026-06-23T01:00:01.000Z"));
    expect(verifyToken(token, LAYER_SECRET)).toBeNull();
  });
});

describe("cron time assertions with setSystemTime", () => {
  afterEach(() => {
    setSystemTime();
  });

  test("cron handler is unit-tested; wall clock jumps via setSystemTime", () => {
    const base = new Date("2026-06-23T00:00:00.000Z");
    setSystemTime(base);

    let fired = 0;
    const tick = () => {
      fired += 1;
    };

    // Bun.cron is 5-field UTC (`*/10 * * * *` = every 10 minutes).
    // setSystemTime alone does not fire in-process cron — test the handler directly.
    tick();
    expect(fired).toBe(1);

    setSystemTime(new Date("2026-06-23T00:10:00.000Z"));
    tick();
    expect(fired).toBe(2);
    expect(new Date().toISOString()).toBe("2026-06-23T00:10:00.000Z");

    // Integration: Bun.cron("*/10 * * * *", tick) — use jest.useFakeTimers() to advance.
    const job = Bun.cron("*/10 * * * *", tick);
    job.stop();
  });
});
