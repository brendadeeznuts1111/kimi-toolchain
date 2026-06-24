import { describe, expect, test } from "bun:test";
import { join } from "path";
import { scanTreeSync } from "../src/lib/globs.ts";
import { cleanupPath, testTempDir } from "./helpers.ts";

describe("scan-tree-sync", () => {
  test("exclude patterns omit map and declaration files", async () => {
    const dir = testTempDir("scan-tree-sync");
    await Bun.write(join(dir, "app.js"), "export {}");
    await Bun.write(join(dir, "app.js.map"), "{}");
    await Bun.write(join(dir, "types.d.ts"), "export {}");
    await Bun.write(join(dir, "nested/lib.js"), "export {}");
    await Bun.write(join(dir, "nested/lib.js.map"), "{}");

    const all = scanTreeSync(dir);
    expect(all.sort()).toEqual([
      "app.js",
      "app.js.map",
      "nested/lib.js",
      "nested/lib.js.map",
      "types.d.ts",
    ]);

    const filtered = scanTreeSync(dir, "**/*", {
      exclude: ["**/*.map", "**/*.d.ts"],
    });
    expect(filtered).toEqual(["app.js", "nested/lib.js"]);

    cleanupPath(dir);
  });
});
