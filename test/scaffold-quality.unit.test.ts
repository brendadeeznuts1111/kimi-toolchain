import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { ensureQualityTooling } from "../src/lib/scaffold-quality.ts";
import { REQUIRED_PACKAGE_SCRIPT_ENTRIES } from "../src/lib/scaffold-templates.ts";

const REPO_ROOT = import.meta.dir + "/..";
const INSTALLED_DEV_DEPS = {
  "@types/bun": "*",
  oxfmt: "*",
  oxlint: "*",
  typescript: "*",
};

describe("scaffold-quality", () => {
  let tmpDir: string;
  const logs: [string, string][] = [];
  const log = (step: string, msg: string) => logs.push([step, msg]);

  beforeEach(() => {
    tmpDir = join(REPO_ROOT, `.tmp-test-scaffold-quality-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    logs.length = 0;
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  test(
    "adds missing scripts to package.json",
    async () => {
      writeFileSync(
        join(tmpDir, "package.json"),
        JSON.stringify(
          { name: "test-project", scripts: {}, devDependencies: INSTALLED_DEV_DEPS },
          null,
          2
        )
      );

      await ensureQualityTooling(tmpDir, false, log);

      const pkg = await Bun.file(join(tmpDir, "package.json")).json();
      expect(pkg.scripts).toEqual(REQUIRED_PACKAGE_SCRIPT_ENTRIES);
    },
    { timeout: 5000 }
  );

  test(
    "is idempotent - does not duplicate existing scripts",
    async () => {
      const existingScripts = {
        test: "bun test",
        check: "bun run check",
        typecheck: "tsc --noEmit",
        format: "prettier --write .",
      };
      writeFileSync(
        join(tmpDir, "package.json"),
        JSON.stringify(
          { name: "test-project", scripts: existingScripts, devDependencies: INSTALLED_DEV_DEPS },
          null,
          2
        )
      );

      await ensureQualityTooling(tmpDir, false, log);

      const pkg = await Bun.file(join(tmpDir, "package.json")).json();
      expect(pkg.scripts.test).toBe("bun test");
      expect(pkg.scripts.check).toBe("bun run check");
      expect(pkg.scripts.typecheck).toBe("tsc --noEmit");
      expect(pkg.scripts.format).toBe("prettier --write .");
    },
    { timeout: 5000 }
  );

  test(
    "does not modify package.json when all scripts exist",
    async () => {
      const allScripts: Record<string, string> = Object.fromEntries(
        Object.keys(REQUIRED_PACKAGE_SCRIPT_ENTRIES).map((key) => [key, `custom ${key}`])
      );
      writeFileSync(
        join(tmpDir, "package.json"),
        JSON.stringify(
          { name: "test-project", scripts: allScripts, devDependencies: INSTALLED_DEV_DEPS },
          null,
          2
        )
      );

      await ensureQualityTooling(tmpDir, false, log);

      const pkg = await Bun.file(join(tmpDir, "package.json")).json();
      for (const [key, value] of Object.entries(allScripts)) {
        expect(pkg.scripts[key]).toBe(value);
      }
    },
    { timeout: 5000 }
  );

  test("dryRun does not write changes", async () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-project", scripts: {}, devDependencies: {} }, null, 2)
    );

    await ensureQualityTooling(tmpDir, true, log);

    const pkg = await Bun.file(join(tmpDir, "package.json")).json();
    expect(pkg.scripts.test).toBeUndefined();
    expect(pkg.scripts.check).toBeUndefined();
  });

  test("handles missing package.json gracefully", async () => {
    await expect(ensureQualityTooling(tmpDir, false, log)).resolves.toBeUndefined();
  });
});
