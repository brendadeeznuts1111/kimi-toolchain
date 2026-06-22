import { describe, expect, test } from "bun:test";
import { join } from "path";
import { auditSecretLeaks } from "../src/doctor/secret-audit.ts";
import { cleanupPath, REPO_ROOT, testTempDir } from "./helpers.ts";

describe("doctor-secret-audit", () => {
  test("flags raw secret-style access in a fixture", async () => {
    const root = testTempDir("secret-audit-fixture-");
    try {
      await Bun.write(join(root, "src", "leak.ts"), `const token = Bun.env["API_TOKEN"];\n`);
      const result = await auditSecretLeaks(root);
      expect(result.findings.map((f) => f.key)).toEqual(["API_TOKEN"]);
    } finally {
      cleanupPath(root);
    }
  });

  test("repo baseline has no unallowlisted secret-style env access", async () => {
    const result = await auditSecretLeaks(REPO_ROOT);
    expect(result.findings).toEqual([]);
  }, 30_000);
});
