import { describe, expect, test } from "bun:test";
import { Effect, Either } from "effect";
import { Identity } from "../src/lib/effect/identity-service.ts";
import { createDashboardSecretsBackend, runDashboardIdentity } from "../src/lib/serve-identity.ts";
import { join } from "path";

describe("serve-identity", () => {
  test("createDashboardSecretsBackend returns dev JWT secret in test env", async () => {
    const backend = createDashboardSecretsBackend();
    const value = await backend.get({
      service: "com.herdr.dashboard",
      name: "jwt-secret",
    });
    expect(value).toBeTruthy();
    expect(typeof value).toBe("string");
  });

  test("runDashboardIdentity signs JWT via SecretsManager policy path", async () => {
    const projectRoot = join(import.meta.dir, "..");
    const result = await runDashboardIdentity(
      Effect.gen(function* () {
        const id = yield* Identity;
        return yield* id.signToken({ sub: "dashboard-user" });
      }),
      projectRoot
    );
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.split(".")).toHaveLength(3);
    }
  });
});
