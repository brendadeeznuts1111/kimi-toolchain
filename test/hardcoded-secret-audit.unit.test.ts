import { describe, expect, test } from "bun:test";
import { join } from "path";
import { auditHardcodedSecrets } from "../src/lib/hardcoded-secret-audit.ts";
import { cleanupPath, REPO_ROOT, testTempDir } from "./helpers.ts";

describe("hardcoded-secret-audit", () => {
  test("flags dev-secret literals and JWT literals", async () => {
    const root = testTempDir("hardcoded-secret-audit-fixture-");
    try {
      await Bun.write(
        join(root, "src", "leak.ts"),
        [
          `const DEV_API_SECRET = "my-app-dev-secret-xyz";`,
          `const token = "eyJhbGciOiJIUzI1NiJ.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";`,
          `const PUBLIC_URL = "https://example.com";`,
        ].join("\n")
      );
      const result = await auditHardcodedSecrets(root);
      expect(result.findings.map((f) => f.type).sort()).toEqual([
        "dev-secret-literal",
        "jwt-literal",
      ]);
    } finally {
      cleanupPath(root);
    }
  });

  test("flags URL credentials, bearer tokens, and known prefixes", async () => {
    const root = testTempDir("hardcoded-secret-audit-fixture-");
    try {
      await Bun.write(
        join(root, "src", "leak.ts"),
        [
          `const proxy = "https://user:pass@proxy.example.com:8080";`,
          `const auth = "Authorization: Bearer abc.def.ghi123456789";`,
          `const stripe = "sk-live-abc123456789def0123456789abcdef";`,
        ].join("\n")
      );
      const result = await auditHardcodedSecrets(root);
      expect(result.findings.map((f) => f.type).sort()).toEqual([
        "bearer-token",
        "known-secret-prefix",
        "url-credentials",
      ]);
    } finally {
      cleanupPath(root);
    }
  });

  test("flags PEM private key blocks", async () => {
    const root = testTempDir("hardcoded-secret-audit-fixture-");
    try {
      await Bun.write(
        join(root, "src", "key.ts"),
        [
          `const key = "-----BEGIN RSA PRIVATE KEY-----";`,
          `  "MIIBOgIBAAJBALRiMLAHbleQ9WvVFx7XnqIi1eDLPAKlWhDuqSI1mHIIq4VHCqGV`,
          `  "G0h4Y2jLNe8dBH+9XwGA4AGKpGWO4zFIB/Ws=";`,
          `  "-----END RSA PRIVATE KEY-----";`,
        ].join("\n")
      );
      const result = await auditHardcodedSecrets(root);
      expect(result.findings.map((f) => f.type)).toEqual(["private-key-block"]);
    } finally {
      cleanupPath(root);
    }
  });

  test("flags high-entropy tokens", async () => {
    const root = testTempDir("hardcoded-secret-audit-fixture-");
    try {
      await Bun.write(
        join(root, "src", "token.ts"),
        `const value = "aBc9xYz2QwE4Rt6Uv8Io0PlKm7NjHf5GaB3Vd6Cs9Fg1Hj4Kl7Mn8Bv0CxZq_WeRt";`
      );
      const result = await auditHardcodedSecrets(root);
      expect(result.findings.map((f) => f.type)).toEqual(["high-entropy-token"]);
    } finally {
      cleanupPath(root);
    }
  });

  test("respects inline ignore comments", async () => {
    const root = testTempDir("hardcoded-secret-audit-fixture-");
    try {
      await Bun.write(
        join(root, "src", "ignored.ts"),
        `const safe = "sk-live-abc123456789def0123456789abcdef"; // kimi-audit:ignore-hardcoded-secret (test fixture)`
      );
      const result = await auditHardcodedSecrets(root);
      expect(result.findings).toEqual([]);
    } finally {
      cleanupPath(root);
    }
  });

  test("repo baseline has no unallowlisted hardcoded secrets", async () => {
    const result = await auditHardcodedSecrets(REPO_ROOT);
    expect(result.findings).toEqual([]);
  }, 30_000);
});
