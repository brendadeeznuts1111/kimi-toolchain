import { describe, expect, test } from "bun:test";
import {
  validateSecretsPolicy,
  resolvePolicyEntry,
  getPolicyEntry,
  getAllPolicyEntries,
  daysSince,
  isStale,
  todayDateString,
} from "../src/lib/secrets-policy.ts";
import type { SecretsPolicyDocument, SecretPolicyEntry } from "../src/lib/secrets-constants.ts";

function validEntry(overrides: Partial<SecretPolicyEntry> = {}): SecretPolicyEntry {
  return {
    allowedConsumers: ["kimi-fix"],
    rotationDays: 90,
    lastRotated: "2025-01-01",
    version: 1,
    ...overrides,
  };
}

function validDoc(overrides: Record<string, unknown> = {}): unknown {
  return {
    $schema: "v1",
    "kimi-toolchain": {
      "cloudflare-api-token": validEntry(),
    },
    ...overrides,
  };
}

describe("secrets-policy", () => {
  describe("validateSecretsPolicy", () => {
    test("accepts a valid policy document", () => {
      const result = validateSecretsPolicy(validDoc());
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("rejects non-object", () => {
      const result = validateSecretsPolicy("not an object");
      expect(result.ok).toBe(false);
    });

    test("rejects wrong $schema version", () => {
      const result = validateSecretsPolicy({ $schema: "v2", "kimi-toolchain": {} });
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain("v1");
    });

    test("rejects empty allowedConsumers", () => {
      const result = validateSecretsPolicy({
        $schema: "v1",
        "kimi-toolchain": {
          "some-key": validEntry({ allowedConsumers: [] }),
        },
      });
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain("allowedConsumers");
    });

    test("rejects non-positive rotationDays", () => {
      const result = validateSecretsPolicy({
        $schema: "v1",
        "kimi-toolchain": {
          "some-key": validEntry({ rotationDays: 0 }),
        },
      });
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain("rotationDays");
    });

    test("rejects invalid lastRotated format", () => {
      const result = validateSecretsPolicy({
        $schema: "v1",
        "kimi-toolchain": {
          "some-key": validEntry({ lastRotated: "Jan 1 2025" }),
        },
      });
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain("lastRotated");
    });

    test("accepts null lastRotated", () => {
      const result = validateSecretsPolicy({
        $schema: "v1",
        "kimi-toolchain": {
          "some-key": validEntry({ lastRotated: null }),
        },
      });
      expect(result.ok).toBe(true);
    });

    test("rejects invalid expiresAt", () => {
      const result = validateSecretsPolicy({
        $schema: "v1",
        "kimi-toolchain": {
          "some-key": validEntry({ expiresAt: "not-a-date" }),
        },
      });
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain("expiresAt");
    });
  });

  describe("resolvePolicyEntry", () => {
    test("returns base entry when no env override", () => {
      const entry = validEntry({ rotationDays: 90 });
      const resolved = resolvePolicyEntry(entry, "production");
      expect(resolved.rotationDays).toBe(90);
    });

    test("merges env override", () => {
      const entry = validEntry({
        rotationDays: 90,
        environments: {
          prod: { rotationDays: 7 },
        },
      });
      const resolved = resolvePolicyEntry(entry, "prod");
      expect(resolved.rotationDays).toBe(7);
    });

    test("strips environments key from resolved entry", () => {
      const entry = validEntry({
        environments: { dev: { rotationDays: 180 } },
      });
      const resolved = resolvePolicyEntry(entry, "dev");
      expect(resolved.environments).toBeUndefined();
    });

    test("defaults to development env", () => {
      const entry = validEntry({
        rotationDays: 90,
        environments: {
          development: { rotationDays: 365 },
        },
      });
      const originalNodeEnv = Bun.env.NODE_ENV;
      Bun.env.NODE_ENV = undefined;
      const resolved = resolvePolicyEntry(entry);
      expect(resolved.rotationDays).toBe(365);
      Bun.env.NODE_ENV = originalNodeEnv;
    });
  });

  describe("getPolicyEntry", () => {
    test("returns null for unknown service", () => {
      const doc = validDoc() as SecretsPolicyDocument;
      expect(getPolicyEntry(doc, "unknown-service", "some-key")).toBeNull();
    });

    test("returns null for unknown name", () => {
      const doc = validDoc() as SecretsPolicyDocument;
      expect(getPolicyEntry(doc, "kimi-toolchain", "unknown-key")).toBeNull();
    });

    test("returns entry for known service/name", () => {
      const doc = validDoc() as SecretsPolicyDocument;
      const entry = getPolicyEntry(doc, "kimi-toolchain", "cloudflare-api-token");
      expect(entry).not.toBeNull();
      expect(entry?.allowedConsumers).toEqual(["kimi-fix"]);
    });
  });

  describe("getAllPolicyEntries", () => {
    test("returns all entries excluding $schema", () => {
      const doc = {
        $schema: "v1",
        "kimi-toolchain": {
          "cloudflare-account-id": validEntry(),
          "cloudflare-api-token": validEntry(),
        },
        "com.herdr.cli": {
          "github-token": validEntry(),
        },
      } as unknown as SecretsPolicyDocument;

      const entries = getAllPolicyEntries(doc);
      expect(entries).toHaveLength(3);
      const services = entries.map((e) => e.service);
      expect(services).toContain("kimi-toolchain");
      expect(services).toContain("com.herdr.cli");
    });
  });

  describe("daysSince", () => {
    test("returns null for null date", () => {
      expect(daysSince(null, new Date())).toBeNull();
    });

    test("returns null for invalid date string", () => {
      expect(daysSince("invalid", new Date())).toBeNull();
    });

    test("returns correct days", () => {
      const now = new Date("2025-06-21");
      expect(daysSince("2025-06-01", now)).toBe(20);
    });
  });

  describe("isStale", () => {
    test("returns stale=true for null lastRotated", () => {
      const entry = validEntry({ lastRotated: null, rotationDays: 90 });
      const result = isStale(entry, new Date());
      expect(result.stale).toBe(true);
      expect(result.daysStale).toBeNull();
    });

    test("returns stale=false for recent rotation", () => {
      const now = new Date("2025-06-21");
      const entry = validEntry({ lastRotated: "2025-06-01", rotationDays: 90 });
      const result = isStale(entry, now);
      expect(result.stale).toBe(false);
      expect(result.daysStale).toBe(20);
    });

    test("returns stale=true for overdue rotation", () => {
      const now = new Date("2025-06-21");
      const entry = validEntry({ lastRotated: "2025-01-01", rotationDays: 90 });
      const result = isStale(entry, now);
      expect(result.stale).toBe(true);
      expect(result.daysStale).toBe(171);
    });
  });

  describe("todayDateString", () => {
    test("returns YYYY-MM-DD format", () => {
      const today = todayDateString();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
