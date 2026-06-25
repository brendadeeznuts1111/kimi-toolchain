import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import { collectNodeModulesTildeDirs } from "../src/lib/deep-hygiene.ts";
import { withTempDir } from "./helpers.ts";

describe("deep-hygiene", () => {
  test("collectNodeModulesTildeDirs finds literal tilde under node_modules", () => {
    withTempDir("deep-hygiene-nm-", (dir) => {
      const tilde = join(dir, "node_modules", ".bun", "pkg", "~", "cache");
      makeDir(tilde, { recursive: true });
      writeText(join(tilde, "x"), "1");
      const items = collectNodeModulesTildeDirs(dir, 12);
      expect(items.length).toBe(1);
      expect(items[0]?.bytes).toBeGreaterThan(0);
    });
  });
});
