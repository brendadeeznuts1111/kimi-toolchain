import { describe, expect, test } from "bun:test";
import { join } from "path";
import { auditHardcodedSecrets } from "../src/doctor/hardcoded-secret-audit.ts";
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

  test("repo baseline has no unallowlisted hardcoded secrets", async () => {
    const result = await auditHardcodedSecrets(REPO_ROOT);
    expect(result.findings).toEqual([]);
  }, 30_000);
});
