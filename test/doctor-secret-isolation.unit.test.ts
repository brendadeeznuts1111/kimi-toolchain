import { describe, expect, test } from "bun:test";
import { join } from "path";
import { checkSecretIsolation } from "../src/doctor/secret-isolation.ts";
import { cleanupPath, REPO_ROOT, testTempDir } from "./helpers.ts";

describe("doctor-secret-isolation", () => {
  test("flags a bin that spawns without resolving secrets", async () => {
    const root = testTempDir("secret-isolation-fixture-");
    const binFile = join(root, "src", "bin", "bad-bin.ts");

    try {
      await Bun.write(binFile, `Bun.spawn(["git", "status"]);`);
      const result = await checkSecretIsolation(root);
      expect(result.errorCount).toBe(1);
      expect(result.issues[0]?.file).toBe("src/bin/bad-bin.ts");
    } finally {
      cleanupPath(root);
    }
  });

  test("passes on the toolchain repo", async () => {
    const result = await checkSecretIsolation(REPO_ROOT);
    expect(result.errorCount).toBe(0);
  }, 30_000);
});
