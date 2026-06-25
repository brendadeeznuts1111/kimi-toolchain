import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Effect, Either } from "effect";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { SecretsManager } from "../src/lib/secrets-manager.ts";
import {
  SecretNotFound,
  SecretPolicyViolation,
  SecretRotationRequired,
} from "../src/lib/effect/errors.ts";
import { SecretKeys, Consumers } from "../src/lib/secrets-constants.ts";
import type { SecretsBackend } from "../src/lib/secrets-constants.ts";
import { writeText, withEnv } from "./helpers.ts";

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
          allowedConsumers: ["identity-service", "herdr-server"],
          rotationDays: 30,
          lastRotated: "2020-01-01",
          version: 1,
        },
        "csrf-secret": {
          allowedConsumers: ["identity-service"],
          rotationDays: 30,
          lastRotated: null,
          version: 1,
        },
      },
    })
  );
}

describe("secrets-manager", () => {
  let tempRoot: string;
  let policyPath: string;
  let auditPath: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "secrets-mgr-"));
    policyPath = join(tempRoot, "policy.json");
    auditPath = join(tempRoot, "audit.jsonl");
    writePolicy(policyPath);
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("get returns secret for allowed consumer", async () => {
    const store = new Map([["com.herdr.dashboard:jwt-secret", "jwt-value"]]);
    const manager = new SecretsManager({
      secrets: makeBackend(store),
      policyPath,
      auditPath,
      env: "development",
    });

    const value = await Effect.runPromise(
      manager.get(SecretKeys.JWT_SECRET, Consumers.IDENTITY_SERVICE)
    );
    expect(value).toBe("jwt-value");
  });

  test("get fails with SecretPolicyViolation for unknown consumer", async () => {
    const store = new Map([["com.herdr.dashboard:jwt-secret", "jwt-value"]]);
    const manager = new SecretsManager({
      secrets: makeBackend(store),
      policyPath,
      auditPath,
      env: "development",
    });

    const result = await Effect.runPromise(
      Effect.either(manager.get(SecretKeys.JWT_SECRET, "unknown-consumer"))
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const err = result.left;
      expect(err).toBeInstanceOf(SecretPolicyViolation);
      if (err instanceof SecretPolicyViolation) {
        expect(err.reason).toBe("consumer_not_allowed");
      }
    }
  });

  test("get fails with SecretNotFound when backend has no value", async () => {
    const manager = new SecretsManager({
      secrets: makeBackend(new Map()),
      policyPath,
      auditPath,
      env: "development",
    });

    const result = await Effect.runPromise(
      Effect.either(manager.get(SecretKeys.JWT_SECRET, Consumers.IDENTITY_SERVICE))
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SecretNotFound);
    }
  });

  test("rotate increments policy version and stores new value", async () => {
    const store = new Map([["com.herdr.dashboard:jwt-secret", "old-value"]]);
    const manager = new SecretsManager({
      secrets: makeBackend(store),
      policyPath,
      auditPath,
      env: "development",
      now: () => new Date("2026-06-21T12:00:00Z"),
    });

    const rotated = await Effect.runPromise(manager.rotate(SecretKeys.JWT_SECRET, "new-value"));
    expect(rotated.version).toBe(2);
    expect(rotated.lastRotated).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const value = await Effect.runPromise(
      manager.get(SecretKeys.JWT_SECRET, Consumers.IDENTITY_SERVICE)
    );
    expect(value).toBe("new-value");
  });

  test("check fails with SecretRotationRequired when secret is stale", async () => {
    const store = new Map([["com.herdr.dashboard:jwt-secret", "jwt-value"]]);
    const manager = new SecretsManager({
      secrets: makeBackend(store),
      policyPath,
      auditPath,
      env: "development",
      now: () => new Date("2026-06-21T12:00:00Z"),
    });

    const result = await Effect.runPromise(Effect.either(manager.check()));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SecretRotationRequired);
      expect(result.left.service).toBe("com.herdr.dashboard");
      expect(result.left.name).toBe("jwt-secret");
    }
  });

  test("check emits storage tier warnings on env-fallback backend", async () => {
    writeText(
      policyPath,
      JSON.stringify({
        $schema: "v1",
        "com.herdr.dashboard": {
          "jwt-secret": {
            allowedConsumers: ["identity-service"],
            rotationDays: 30,
            lastRotated: "2026-06-20",
            version: 1,
          },
        },
      })
    );
    const store = new Map([["com.herdr.dashboard:jwt-secret", "jwt-value"]]);
    const warnings: string[] = [];
    const manager = new SecretsManager({
      secrets: makeBackend(store),
      policyPath,
      auditPath,
      env: "development",
      now: () => new Date("2026-06-21T12:00:00Z"),
      detectBackend: async () => "env-fallback",
      onWarn: (message) => warnings.push(message),
    });

    const results = await Effect.runPromise(manager.check());
    const jwt = results.find((r) => r.key.name === "jwt-secret");
    expect(jwt?.storageWarning).toContain("policy expects");
    expect(warnings.some((w) => w.includes("libsecret unavailable"))).toBe(true);
    expect(warnings.some((w) => w.includes("jwt-secret"))).toBe(true);
  });

  test("check skips per-secret warning when storageTier is env-fallback", async () => {
    writeText(
      policyPath,
      JSON.stringify({
        $schema: "v1",
        "com.herdr.ci": {
          "github-token": {
            allowedConsumers: ["cli-tool"],
            storageTier: "env-fallback",
            rotationDays: 1,
            lastRotated: "2026-06-21",
            version: 1,
          },
        },
      })
    );
    const store = new Map([["com.herdr.ci:github-token", "ghp_ci"]]);
    const warnings: string[] = [];
    const manager = new SecretsManager({
      secrets: makeBackend(store),
      policyPath,
      auditPath,
      env: "ci",
      now: () => new Date("2026-06-21T12:00:00Z"),
      detectBackend: async () => "env-fallback",
      onWarn: (message) => warnings.push(message),
    });

    const results = await Effect.runPromise(manager.check());
    expect(results).toHaveLength(1);
    expect(results[0]?.storageWarning).toBeUndefined();
    expect(warnings.some((w) => w.includes("github-token") && w.includes("policy expects"))).toBe(
      false
    );
  });

  test("get resolves env-fallback tier secret from env vars", async () => {
    writeText(
      policyPath,
      JSON.stringify({
        $schema: "v1",
        "com.herdr.ci": {
          "github-token": {
            allowedConsumers: ["cli-tool"],
            storageTier: "env-fallback",
            rotationDays: 1,
            lastRotated: "2026-06-21",
            version: 1,
          },
        },
      })
    );
    const manager = new SecretsManager({
      secrets: makeBackend(new Map()),
      policyPath,
      auditPath,
      env: "ci",
      envVars: { GITHUB_TOKEN: "ghp_from_env" },
      detectBackend: async () => "env-fallback",
    });

    const value = await Effect.runPromise(
      manager.get(SecretKeys.CI_GITHUB_TOKEN, Consumers.CLI_TOOL)
    );
    expect(value).toBe("ghp_from_env");
  });

  test("check marks storage_mismatch when secure secret present on env-fallback backend", async () => {
    writeText(
      policyPath,
      JSON.stringify({
        $schema: "v1",
        "com.herdr.dashboard": {
          "jwt-secret": {
            allowedConsumers: ["identity-service"],
            rotationDays: 30,
            lastRotated: "2026-06-20",
            version: 1,
          },
        },
      })
    );
    const store = new Map([["com.herdr.dashboard:jwt-secret", "jwt-value"]]);
    const manager = new SecretsManager({
      secrets: makeBackend(store),
      policyPath,
      auditPath,
      env: "development",
      now: () => new Date("2026-06-21T12:00:00Z"),
      detectBackend: async () => "env-fallback",
      onWarn: () => {},
    });

    const results = await Effect.runPromise(manager.check());
    expect(results[0]?.status).toBe("storage_mismatch");
    expect(results[0]?.storageMismatch).toBe(true);
  });

  test("storageStatus reports insecure secret count on env-fallback backend", async () => {
    const manager = new SecretsManager({
      secrets: makeBackend(new Map()),
      policyPath,
      auditPath,
      detectBackend: async () => "env-fallback",
      onWarn: () => {},
    });

    const status = await manager.storageStatus();
    expect(status.backend).toBe("env-fallback");
    expect(status.securityLevel).toBe("low");
    expect(status.insecureSecretCount).toBeGreaterThan(0);
  });

  test("get fails with storage_tier_mismatch when strict storage enabled", async () => {
    writeText(
      policyPath,
      JSON.stringify({
        $schema: "v1",
        "com.herdr.dashboard": {
          "jwt-secret": {
            allowedConsumers: ["identity-service"],
            rotationDays: 30,
            lastRotated: "2026-06-20",
            version: 1,
          },
        },
      })
    );
    const store = new Map([["com.herdr.dashboard:jwt-secret", "jwt-value"]]);

    await withEnv({ KIMI_SECRETS_STRICT_STORAGE: "1" }, async () => {
      const manager = new SecretsManager({
        secrets: makeBackend(store),
        policyPath,
        auditPath,
        detectBackend: async () => "env-fallback",
        onWarn: () => {},
      });

      const result = await Effect.runPromise(
        Effect.either(manager.get(SecretKeys.JWT_SECRET, Consumers.IDENTITY_SERVICE))
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(SecretPolicyViolation);
        if (result.left instanceof SecretPolicyViolation) {
          expect(result.left.reason).toBe("storage_tier_mismatch");
        }
      }
    });
  });

  test("storageBackend caches detectBackend result", async () => {
    let calls = 0;
    const manager = new SecretsManager({
      secrets: makeBackend(new Map()),
      policyPath,
      auditPath,
      detectBackend: async () => {
        calls += 1;
        return "keychain";
      },
    });

    expect(await manager.storageBackend()).toBe("keychain");
    expect(await manager.storageBackend()).toBe("keychain");
    expect(calls).toBe(1);
  });

  test("list reports policy entries with presence", async () => {
    const store = new Map([
      ["com.herdr.dashboard:jwt-secret", "jwt-value"],
      ["com.herdr.dashboard:csrf-secret", "csrf-value"],
    ]);
    const manager = new SecretsManager({
      secrets: makeBackend(store),
      policyPath,
      auditPath,
      env: "development",
    });

    const listed = await Effect.runPromise(manager.list());
    expect(listed.length).toBe(2);
    expect(listed.every((row) => row.present)).toBe(true);
  });
});
