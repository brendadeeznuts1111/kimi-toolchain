import { describe, expect, test } from "bun:test";
import { appendSecretAudit, readSecretAudit, filterSecretAudit } from "../src/lib/secrets-audit.ts";
import type { SecretAuditRecord } from "../src/lib/secrets-types.ts";
import { join } from "path";
import { rmSync, existsSync } from "fs";

function tmpAuditPath(): string {
  return join(import.meta.dir, ".tmp-secrets-audit-test.ndjson");
}

function cleanup(path: string): void {
  if (existsSync(path)) rmSync(path, { force: true });
}

function record(overrides: Partial<SecretAuditRecord> = {}): SecretAuditRecord {
  return {
    timestamp: new Date().toISOString(),
    action: "get",
    service: "kimi-toolchain",
    name: "cloudflare-api-token",
    consumer: "kimi-cloudflare-access",
    success: true,
    ...overrides,
  };
}

describe("secrets-audit", () => {
  describe("appendSecretAudit + readSecretAudit", () => {
    test("appends and reads a single record", async () => {
      const path = tmpAuditPath();
      cleanup(path);
      try {
        await appendSecretAudit(path, record());
        const records = await readSecretAudit(path);
        expect(records).toHaveLength(1);
        expect(records[0].service).toBe("kimi-toolchain");
        expect(records[0].action).toBe("get");
      } finally {
        cleanup(path);
      }
    });

    test("appends multiple records", async () => {
      const path = tmpAuditPath();
      cleanup(path);
      try {
        await appendSecretAudit(path, record({ consumer: "a" }));
        await appendSecretAudit(path, record({ consumer: "b" }));
        await appendSecretAudit(path, record({ consumer: "c" }));
        const records = await readSecretAudit(path);
        expect(records).toHaveLength(3);
        expect(records.map((r) => r.consumer)).toEqual(["a", "b", "c"]);
      } finally {
        cleanup(path);
      }
    });

    test("returns empty array for missing file", async () => {
      const path = join(import.meta.dir, ".nonexistent-audit.ndjson");
      cleanup(path);
      const records = await readSecretAudit(path);
      expect(records).toEqual([]);
    });
  });

  describe("filterSecretAudit", () => {
    const records: SecretAuditRecord[] = [
      record({
        timestamp: "2025-06-01T10:00:00Z",
        consumer: "a",
        service: "svc1",
        name: "key1",
        action: "get",
      }),
      record({
        timestamp: "2025-06-02T10:00:00Z",
        consumer: "b",
        service: "svc2",
        name: "key2",
        action: "set",
      }),
      record({
        timestamp: "2025-06-03T10:00:00Z",
        consumer: "a",
        service: "svc1",
        name: "key1",
        action: "delete",
      }),
    ];

    test("filters by consumer", () => {
      const filtered = filterSecretAudit(records, { consumer: "a" });
      expect(filtered).toHaveLength(2);
    });

    test("filters by service", () => {
      const filtered = filterSecretAudit(records, { service: "svc2" });
      expect(filtered).toHaveLength(1);
    });

    test("filters by action", () => {
      const filtered = filterSecretAudit(records, { action: "set" });
      expect(filtered).toHaveLength(1);
    });

    test("filters by since", () => {
      const filtered = filterSecretAudit(records, { since: "2025-06-02T10:00:00Z" });
      expect(filtered).toHaveLength(2);
    });

    test("filters by multiple criteria", () => {
      const filtered = filterSecretAudit(records, {
        consumer: "a",
        action: "get",
      });
      expect(filtered).toHaveLength(1);
    });

    test("returns all for empty query", () => {
      const filtered = filterSecretAudit(records, {});
      expect(filtered).toHaveLength(3);
    });
  });
});
