import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { join } from "path";
import { rmSync, existsSync, writeFileSync, mkdirSync } from "fs";
import {
  runPreflight,
  resolveSecretsForEnv,
  runInstallSecure,
  quickCheck,
} from "../src/lib/install-secure.ts";
import { SecretsManager } from "../src/lib/secrets-manager.ts";
import type { SecretsBackend, SecretPolicyEntry } from "../src/lib/secrets-types.ts";

// ── Helpers ──────────────────────────────────────────────────────────

function tmpDir(): string {
  return join(import.meta.dir, ".tmp-install-secure-" + Math.random().toString(36).slice(2));
}

function tmpPolicyPath(): string {
  return join(tmpDir(), "secrets-policy.json5");
}

function tmpAuditPath(): string {
  return join(tmpDir(), "secrets-audit.ndjson");
}

function validEntry(overrides: Partial<SecretPolicyEntry> = {}): SecretPolicyEntry {
  return {
    allowedConsumers: ["bun-install"],
    rotationDays: 365,
    lastRotated: "2025-05-01",
    version: 1,
    ...overrides,
  };
}

function writeTmpPolicy(path: string): void {
  const dir = join(path, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      $schema: "v1",
      "kimi-toolchain": {
        "cloudflare-account-id": validEntry({
          allowedConsumers: ["kimi-cloudflare-access", "kimi-doctor", "bun-install"],
          rotationDays: 365,
          lastRotated: "2025-05-01",
        }),
        "cloudflare-api-token": validEntry({
          allowedConsumers: ["kimi-cloudflare-access", "kimi-doctor", "bun-install"],
          rotationDays: 90,
          lastRotated: "2025-05-15",
        }),
      },
    })
  );
}

function cleanup(path: string): void {
  if (existsSync(path)) rmSync(path, { force: true, recursive: true });
  const dir = join(path, "..");
  if (existsSync(dir)) {
    try {
      rmSync(dir, { force: true, recursive: true });
    } catch {
      // ignore
    }
  }
}

function mockBackend(stored: Map<string, string> = new Map()): SecretsBackend {
  return {
    async get(opts: { service: string; name: string }): Promise<string | null> {
      return stored.get(`${opts.service}:${opts.name}`) ?? null;
    },
    async set(opts: { service: string; name: string; value: string }): Promise<void> {
      stored.set(`${opts.service}:${opts.name}`, opts.value);
    },
    async delete(opts: { service: string; name: string }): Promise<boolean> {
      return stored.delete(`${opts.service}:${opts.name}`);
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("install-secure", () => {
  describe("runPreflight", () => {
    test("returns ok when all secrets present and non-stale", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      const stored = new Map([
        ["kimi-toolchain:cloudflare-account-id", "acc-123"],
        ["kimi-toolchain:cloudflare-api-token", "tok-123"],
      ]);
      const now = new Date("2025-06-01");
      const manager = new SecretsManager({
        secrets: mockBackend(stored),
        policyPath,
        auditPath,
        now: () => now,
      });
      try {
        const result = await Effect.runPromise(runPreflight(manager));
        expect(result.ok).toBe(true);
        expect(result.warnings).toHaveLength(0);
        expect(result.rotationRequired).toHaveLength(0);
        expect(result.results).toHaveLength(2);
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });

    test("returns warnings for missing secrets", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      const manager = new SecretsManager({
        secrets: mockBackend(),
        policyPath,
        auditPath,
      });
      try {
        const result = await Effect.runPromise(runPreflight(manager));
        expect(result.ok).toBe(false);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings.some((w) => w.includes("Missing"))).toBe(true);
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });

    test("returns rotationRequired for stale secrets", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      const stored = new Map([["kimi-toolchain:cloudflare-api-token", "tok-123"]]);
      const now = new Date("2025-12-01");
      const manager = new SecretsManager({
        secrets: mockBackend(stored),
        policyPath,
        auditPath,
        now: () => now,
      });
      try {
        const result = await Effect.runPromise(runPreflight(manager));
        expect(result.ok).toBe(false);
        expect(result.rotationRequired.length).toBeGreaterThan(0);
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });
  });

  describe("resolveSecretsForEnv", () => {
    test("resolves required secrets into env var format", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      const stored = new Map([
        ["kimi-toolchain:cloudflare-account-id", "acc-123"],
        ["kimi-toolchain:cloudflare-api-token", "tok-123"],
      ]);
      const manager = new SecretsManager({
        secrets: mockBackend(stored),
        policyPath,
        auditPath,
      });
      try {
        const resolved = await Effect.runPromise(
          resolveSecretsForEnv(manager, [
            {
              key: { service: "kimi-toolchain", name: "cloudflare-api-token" },
              consumer: "bun-install",
            },
          ])
        );
        expect(resolved).toHaveLength(1);
        expect(resolved[0].envVar).toBe("CLOUDFLARE_API_TOKEN");
        expect(resolved[0].value).toBe("tok-123");
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });

    test("fails when required secret is missing", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      const manager = new SecretsManager({
        secrets: mockBackend(),
        policyPath,
        auditPath,
      });
      try {
        const exit = await Effect.runPromiseExit(
          resolveSecretsForEnv(manager, [
            {
              key: { service: "kimi-toolchain", name: "cloudflare-api-token" },
              consumer: "bun-install",
            },
          ])
        );
        expect(exit._tag).toBe("Failure");
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });
  });

  describe("runInstallSecure", () => {
    test("dry-run mode skips bun install but runs preflight", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      const stored = new Map([
        ["kimi-toolchain:cloudflare-account-id", "acc-123"],
        ["kimi-toolchain:cloudflare-api-token", "tok-123"],
      ]);
      const now = new Date("2025-06-01");
      try {
        const result = await Effect.runPromise(
          runInstallSecure({
            secrets: mockBackend(stored),
            policyPath,
            auditPath,
            now: () => now,
            dryRun: true,
            mode: "install",
          })
        );
        expect(result.exitCode).toBe(0);
        expect(result.preflight.ok).toBe(true);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });

    test("dry-run with required secrets injects env vars", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      const stored = new Map([
        ["kimi-toolchain:cloudflare-account-id", "acc-123"],
        ["kimi-toolchain:cloudflare-api-token", "tok-123"],
      ]);
      const now = new Date("2025-06-01");
      try {
        const result = await Effect.runPromise(
          runInstallSecure({
            secrets: mockBackend(stored),
            policyPath,
            auditPath,
            now: () => now,
            dryRun: true,
            requiredSecrets: [
              {
                key: { service: "kimi-toolchain", name: "cloudflare-api-token" },
                consumer: "bun-install",
              },
            ],
          })
        );
        expect(result.injectedSecrets).toEqual(["CLOUDFLARE_API_TOKEN"]);
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });

    test("skipPreflight bypasses check()", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      try {
        const result = await Effect.runPromise(
          runInstallSecure({
            secrets: mockBackend(),
            policyPath,
            auditPath,
            dryRun: true,
            skipPreflight: true,
          })
        );
        expect(result.preflight.ok).toBe(true);
        expect(result.preflight.results).toHaveLength(0);
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });
  });

  describe("quickCheck", () => {
    test("returns ok for healthy secrets", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      const stored = new Map([
        ["kimi-toolchain:cloudflare-account-id", "acc-123"],
        ["kimi-toolchain:cloudflare-api-token", "tok-123"],
      ]);
      const now = new Date("2025-06-01");
      try {
        const result = await quickCheck({
          secrets: mockBackend(stored),
          policyPath,
          auditPath,
          now: () => now,
        });
        expect(result.ok).toBe(true);
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });

    test("returns not-ok for missing secrets", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      try {
        const result = await quickCheck({
          secrets: mockBackend(),
          policyPath,
          auditPath,
        });
        expect(result.ok).toBe(false);
        expect(result.warnings.length).toBeGreaterThan(0);
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });
  });
});
