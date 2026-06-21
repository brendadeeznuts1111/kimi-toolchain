import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { artifactPath } from "../src/lib/artifacts.ts";
import { ensureQualityTooling } from "../src/lib/scaffold-quality.ts";

const REPO_ROOT = import.meta.dir + "/..";

describe("scaffold-quality", () => {
  let tmpDir: string;
  const logs: [string, string][] = [];
  const log = (step: string, msg: string) => logs.push([step, msg]);

  beforeEach(() => {
    tmpDir = artifactPath(REPO_ROOT, "tmp", `scaffold-quality-${Date.now()}`);
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
        JSON.stringify({ name: "test-project", scripts: {}, devDependencies: {} }, null, 2)
      );

      await ensureQualityTooling(tmpDir, false, log);

      const pkg = await Bun.file(join(tmpDir, "package.json")).json();
      expect(pkg.scripts.test).toBeDefined();
      expect(pkg.scripts["test:fast"]).toBeDefined();
      expect(pkg.scripts.check).toBeDefined();
      expect(pkg.scripts["check:fast"]).toBeDefined();
      expect(pkg.scripts.typecheck).toBeDefined();
      expect(pkg.scripts.format).toBeDefined();
      expect(pkg.scripts["format:check"]).toBeDefined();
      expect(pkg.scripts["format:check:ci"]).toBeDefined();
      expect(pkg.scripts.lint).toBeDefined();
      expect(pkg.scripts.fix).toBeDefined();
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
          { name: "test-project", scripts: existingScripts, devDependencies: {} },
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
      const allScripts: Record<string, string> = {
        test: "bun test",
        "test:fast": "bun test --fast",
        "test:coverage": "bun test --coverage",
        "test:coverage:ci": "bun test --ci --coverage",
        check: "bun run check",
        "check:fast": "bun run check --fast",
        "check:dry-run": "bun run check --dry-run",
        "docs:sync": "bun run docs:sync",
        typecheck: "tsc --noEmit",
        format: "oxfmt --write .",
        "format:check": "oxfmt --check .",
        "format:check:ci": "oxfmt --check --threads=4 .",
        lint: "oxlint src",
        "lint:terms": "bun run lint:terms",
        fix: "kimi-fix .",
      };
      writeFileSync(
        join(tmpDir, "package.json"),
        JSON.stringify({ name: "test-project", scripts: allScripts, devDependencies: {} }, null, 2)
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

  test("toolchain profile adds finish-work script", async () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-project", scripts: {}, devDependencies: {} }, null, 2)
    );

    await ensureQualityTooling(tmpDir, false, log, "toolchain");

    const pkg = await Bun.file(join(tmpDir, "package.json")).json();
    expect(pkg.scripts["finish-work"]).toBe("bun run scripts/finish-work.ts");
  });
});
