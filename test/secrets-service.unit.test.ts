import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Effect, Either, Layer } from "effect";
import { join } from "path";
import { Secrets, SecretsTest } from "../src/lib/effect/secrets-service.ts";
import { SecretNotFound, SecretPolicyViolation } from "../src/lib/effect/errors.ts";
import { SecretKeys, Consumers } from "../src/lib/secrets-constants.ts";
import type { SecretsBackend } from "../src/lib/secrets-types.ts";
import { writeText, removePath, testTempDir } from "./helpers.ts";

function makeBackend(store: Map<string, string>): SecretsBackend {
  return {
    get: async ({ service, name }) => store.get(`${service}:${name}`) ?? null,
    set: async ({ service, name, value }) => {
      store.set(`${service}:${name}`, value);
    },
    delete: async ({ service, name }) => store.delete(`${service}:${name}`),
  };
}

function writePolicy(path: string): void {
  writeText(
    path,
    JSON.stringify({
      $schema: "v1",
      "com.herdr.dashboard": {
        "jwt-secret": {
          allowedConsumers: ["identity-service"],
          rotationDays: 30,
          lastRotated: null,
          version: 1,
        },
      },
    })
  );
}

describe("secrets-service", () => {
  let tempRoot: string;
  let policyPath: string;
  let auditPath: string;
  let layer: Layer.Layer<Secrets>;

  beforeEach(() => {
    tempRoot = testTempDir("secrets-svc-");
    policyPath = join(tempRoot, "policy.json");
    auditPath = join(tempRoot, "audit.jsonl");
    writePolicy(policyPath);
    const store = new Map([["com.herdr.dashboard:jwt-secret", "layer-jwt"]]);
    layer = SecretsTest(makeBackend(store), { policyPath, auditPath, env: "development" });
  });

  afterEach(() => {
    removePath(tempRoot, { recursive: true, force: true });
  });

  test("SecretsTest layer resolves registered secret", async () => {
    const value = await Effect.runPromise(
      Effect.gen(function* () {
        const secrets = yield* Secrets;
        return yield* secrets.get(SecretKeys.JWT_SECRET, Consumers.IDENTITY_SERVICE);
      }).pipe(Effect.provide(layer))
    );
    expect(value).toBe("layer-jwt");
  });

  test("SecretsTest layer maps policy violation to tagged error", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const secrets = yield* Secrets;
        return yield* secrets.get(SecretKeys.JWT_SECRET, "blocked-consumer");
      })
        .pipe(Effect.either)
        .pipe(Effect.provide(layer))
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SecretPolicyViolation);
    }
  });

  test("SecretsTest layer maps missing backend value to SecretNotFound", async () => {
    const emptyLayer = SecretsTest(makeBackend(new Map()), {
      policyPath,
      auditPath,
      env: "development",
    });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const secrets = yield* Secrets;
        return yield* secrets.get(SecretKeys.JWT_SECRET, Consumers.IDENTITY_SERVICE);
      })
        .pipe(Effect.either)
        .pipe(Effect.provide(emptyLayer))
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SecretNotFound);
    }
  });
});
