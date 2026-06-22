import { describe, expect, test } from "bun:test";
import { SecretsManager } from "../src/lib/secrets-manager.ts";
import type { SecretsBackend, SecretPolicyEntry } from "../src/lib/secrets-types.ts";
import { Effect } from "effect";
import { join } from "path";
import { rmSync, existsSync, writeFileSync, mkdirSync } from "fs";

function mockBackend(stored: Map<string, string> = new Map()): SecretsBackend {
  return {
    async get(opts: { service: string; name: string }): Promise<string | null> {
      return stored.get(`${opts.service}:${opts.name}`) ?? null;
    },
    async set(opts: { service: string; name: string; value: string }): Promise<void> {
      stored.set(`${opts.service}:${opts.name}`, opts.value);
    },
    async delete(opts: { service: string; name: string }): Promise<boolean> {
      const key = `${opts.service}:${opts.name}`;
      if (stored.has(key)) {
        stored.delete(key);
        return true;
      }
      return false;
    },
  };
}

function validEntry(overrides: Partial<SecretPolicyEntry> = {}): SecretPolicyEntry {
  return {
    allowedConsumers: ["kimi-cloudflare-access", "kimi-doctor"],
    rotationDays: 90,
    lastRotated: "2025-01-01",
    version: 1,
    ...overrides,
  };
}

function tmpPolicyPath(): string {
  return join(import.meta.dir, ".tmp-secrets-policy-test.json5");
}

function tmpAuditPath(): string {
  return join(import.meta.dir, ".tmp-secrets-manager-audit-test.ndjson");
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
          allowedConsumers: ["kimi-cloudflare-access", "kimi-doctor"],
          rotationDays: 365,
          lastRotated: "2025-05-01",
        }),
        "cloudflare-api-token": validEntry({
          allowedConsumers: ["kimi-cloudflare-access", "kimi-doctor"],
          rotationDays: 90,
          lastRotated: "2025-05-15",
        }),
      },
    })
  );
}

function cleanup(path: string): void {
  if (existsSync(path)) rmSync(path, { force: true });
}

describe("secrets-manager", () => {
  describe("get", () => {
    test("returns value when consumer is allowed and secret exists", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      const stored = new Map([["kimi-toolchain:cloudflare-api-token", "tok-123"]]);
      const manager = new SecretsManager({
        secrets: mockBackend(stored),
        policyPath,
        auditPath,
      });
      try {
        const value = await Effect.runPromise(
          manager.get(
            { service: "kimi-toolchain", name: "cloudflare-api-token" },
            "kimi-cloudflare-access"
          )
        );
        expect(value).toBe("tok-123");
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });

    test("fails with SecretPolicyViolation when consumer not allowed", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      const stored = new Map([["kimi-toolchain:cloudflare-api-token", "tok-123"]]);
      const manager = new SecretsManager({
        secrets: mockBackend(stored),
        policyPath,
        auditPath,
      });
      try {
        const exit = await Effect.runPromiseExit(
          manager.get(
            { service: "kimi-toolchain", name: "cloudflare-api-token" },
            "unknown-consumer"
          )
        );
        expect(exit._tag).toBe("Failure");
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });

    test("fails with SecretNotFound when secret does not exist", async () => {
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
          manager.get(
            { service: "kimi-toolchain", name: "cloudflare-api-token" },
            "kimi-cloudflare-access"
          )
        );
        expect(exit._tag).toBe("Failure");
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });

    test("returns cached value on second call", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      let getCallCount = 0;
      const stored = new Map([["kimi-toolchain:cloudflare-api-token", "tok-123"]]);
      const countingBackend: SecretsBackend = {
        async get(opts) {
          getCallCount++;
          return stored.get(`${opts.service}:${opts.name}`) ?? null;
        },
        async set(opts) {
          stored.set(`${opts.service}:${opts.name}`, opts.value);
        },
        async delete(opts) {
          const key = `${opts.service}:${opts.name}`;
          if (stored.has(key)) {
            stored.delete(key);
            return true;
          }
          return false;
        },
      };
      const manager = new SecretsManager({
        secrets: countingBackend,
        policyPath,
        auditPath,
      });
      try {
        await Effect.runPromise(
          manager.get(
            { service: "kimi-toolchain", name: "cloudflare-api-token" },
            "kimi-cloudflare-access"
          )
        );
        await Effect.runPromise(
          manager.get(
            { service: "kimi-toolchain", name: "cloudflare-api-token" },
            "kimi-cloudflare-access"
          )
        );
        expect(getCallCount).toBe(1);
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });
  });

  describe("set", () => {
    test("stores value in backend", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      const stored = new Map();
      const manager = new SecretsManager({
        secrets: mockBackend(stored),
        policyPath,
        auditPath,
      });
      try {
        await Effect.runPromise(
          manager.set({ service: "kimi-toolchain", name: "cloudflare-api-token" }, "new-token")
        );
        expect(stored.get("kimi-toolchain:cloudflare-api-token")).toBe("new-token");
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });
  });

  describe("delete", () => {
    test("deletes value from backend", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      const stored = new Map([["kimi-toolchain:cloudflare-api-token", "tok-123"]]);
      const manager = new SecretsManager({
        secrets: mockBackend(stored),
        policyPath,
        auditPath,
      });
      try {
        const deleted = await Effect.runPromise(
          manager.delete({ service: "kimi-toolchain", name: "cloudflare-api-token" })
        );
        expect(deleted).toBe(true);
        expect(stored.has("kimi-toolchain:cloudflare-api-token")).toBe(false);
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });

    test("returns false for missing secret", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      const manager = new SecretsManager({
        secrets: mockBackend(),
        policyPath,
        auditPath,
      });
      try {
        const deleted = await Effect.runPromise(
          manager.delete({ service: "kimi-toolchain", name: "cloudflare-api-token" })
        );
        expect(deleted).toBe(false);
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });
  });

  describe("rotate", () => {
    test("generates new value and updates policy version", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      const stored = new Map([["kimi-toolchain:cloudflare-api-token", "old-token"]]);
      const manager = new SecretsManager({
        secrets: mockBackend(stored),
        policyPath,
        auditPath,
      });
      try {
        const result = await Effect.runPromise(
          manager.rotate({ service: "kimi-toolchain", name: "cloudflare-api-token" })
        );
        expect(result.version).toBe(2);
        expect(result.lastRotated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(stored.get("kimi-toolchain:cloudflare-api-token")).not.toBe("old-token");
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });

    test("accepts explicit new value", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      const stored = new Map();
      const manager = new SecretsManager({
        secrets: mockBackend(stored),
        policyPath,
        auditPath,
      });
      try {
        const result = await Effect.runPromise(
          manager.rotate(
            { service: "kimi-toolchain", name: "cloudflare-api-token" },
            "explicit-new-value"
          )
        );
        expect(result.version).toBe(2);
        expect(stored.get("kimi-toolchain:cloudflare-api-token")).toBe("explicit-new-value");
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });
  });

  describe("check", () => {
    test("returns ok for present, non-stale secrets", async () => {
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
        const results = await Effect.runPromise(manager.check());
        expect(results).toHaveLength(2);
        expect(results.every((r) => r.status === "ok")).toBe(true);
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });

    test("returns missing for absent secrets", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      const manager = new SecretsManager({
        secrets: mockBackend(),
        policyPath,
        auditPath,
      });
      try {
        const results = await Effect.runPromise(manager.check());
        expect(results).toHaveLength(2);
        expect(results.every((r) => r.status === "missing")).toBe(true);
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });

    test("returns stale for overdue secrets", async () => {
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
        const exit = await Effect.runPromiseExit(manager.check());
        expect(exit._tag).toBe("Failure");
        if (exit._tag === "Failure") {
          const errors = exit.cause;
          expect(errors).toBeDefined();
        }
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });
  });

  describe("clearCache", () => {
    test("clears value cache so next get hits backend", async () => {
      const policyPath = tmpPolicyPath();
      const auditPath = tmpAuditPath();
      writeTmpPolicy(policyPath);
      let getCallCount = 0;
      const stored = new Map([["kimi-toolchain:cloudflare-api-token", "tok-123"]]);
      const countingBackend: SecretsBackend = {
        async get(opts) {
          getCallCount++;
          return stored.get(`${opts.service}:${opts.name}`) ?? null;
        },
        async set(opts) {
          stored.set(`${opts.service}:${opts.name}`, opts.value);
        },
        async delete(opts) {
          const key = `${opts.service}:${opts.name}`;
          if (stored.has(key)) {
            stored.delete(key);
            return true;
          }
          return false;
        },
      };
      const manager = new SecretsManager({
        secrets: countingBackend,
        policyPath,
        auditPath,
      });
      try {
        await Effect.runPromise(
          manager.get(
            { service: "kimi-toolchain", name: "cloudflare-api-token" },
            "kimi-cloudflare-access"
          )
        );
        expect(getCallCount).toBe(1);
        manager.clearCache();
        await Effect.runPromise(
          manager.get(
            { service: "kimi-toolchain", name: "cloudflare-api-token" },
            "kimi-cloudflare-access"
          )
        );
        expect(getCallCount).toBe(2);
      } finally {
        cleanup(policyPath);
        cleanup(auditPath);
      }
    });
  });
});
