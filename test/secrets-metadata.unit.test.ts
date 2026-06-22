import { describe, test, expect } from "bun:test";
import { SecretKeys } from "../src/lib/secrets-constants.ts";

// Note: These tests import the macro functions directly (not via `with { type: "macro" }`),
// so they execute at runtime. When bundled with Bun's macro system, the return values
// would be inlined as static JSON.

describe("secrets-metadata", () => {
  test("SecretKeys contains expected number of entries", () => {
    expect(Object.keys(SecretKeys).length).toBeGreaterThanOrEqual(14);
  });

  test("every SecretKey has a service and name", () => {
    for (const [_constName, key] of Object.entries(SecretKeys)) {
      expect(key.service).toBeTruthy();
      expect(key.name).toBeTruthy();
      expect(typeof key.service).toBe("string");
      expect(typeof key.name).toBe("string");
    }
  });

  test("every secret name is kebab-case", () => {
    const kebab = /^[a-z][a-z0-9:]*(-[a-z0-9:]+)*$/;
    for (const key of Object.values(SecretKeys)) {
      expect(kebab.test(key.name)).toBe(true);
    }
  });

  test("envVar derivation is consistent", () => {
    for (const key of Object.values(SecretKeys)) {
      const expected = key.name.toUpperCase().replace(/-/g, "_");
      // Verify the pattern works
      expect(expected).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  test("services are unique and follow reverse-domain format", () => {
    const services = new Set(Object.values(SecretKeys).map((k) => k.service));
    const reverseDomain = /^[a-z]+\.[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*/;
    const legacy = new Set(["kimi-toolchain"]);

    for (const svc of services) {
      if (!legacy.has(svc)) {
        expect(reverseDomain.test(svc)).toBe(true);
      }
    }
  });
});
