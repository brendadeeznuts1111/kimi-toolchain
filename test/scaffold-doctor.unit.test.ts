import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { checkScaffold } from "../src/lib/scaffold-doctor.ts";
import { REQUIRED_PACKAGE_SCRIPT_ENTRIES } from "../src/lib/scaffold-templates.ts";

const REPO_ROOT = import.meta.dir + "/..";

describe("scaffold-doctor", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(REPO_ROOT, `.tmp-test-scaffold-doctor-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  test("warns when CI coverage script is missing", async () => {
    const scripts: Record<string, string> = { ...REQUIRED_PACKAGE_SCRIPT_ENTRIES };
    delete scripts["test:coverage:ci"];
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "demo", scripts }, null, 2));

    const checks = await checkScaffold(tmpDir);
    const packageScripts = checks.find((check) => check.name === "package-scripts");

    expect(packageScripts?.status).toBe("warn");
    expect(packageScripts?.message).toContain("test:coverage:ci");
    expect(packageScripts?.fixable).toBe(true);
  });
});
