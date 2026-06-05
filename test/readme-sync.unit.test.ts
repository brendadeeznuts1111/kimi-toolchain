import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { checkDocDrift, patchReadmeScripts } from "../src/lib/readme-sync.ts";

const REPO_ROOT = import.meta.dir + "/..";
let tmpDir: string;

describe("readme-sync", () => {
  beforeEach(() => {
    tmpDir = join(REPO_ROOT, `.tmp-readme-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  test("checkDocDrift detects missing scripts", async () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { test: "bun test", "check:fast": "bun run check" } }, null, 2)
    );
    writeFileSync(
      join(tmpDir, "README.md"),
      "### Project Scripts\n\n| `bun run test` | Run tests |\n\n### Governance\n"
    );

    const drift = await checkDocDrift(tmpDir);
    expect(drift.fresh).toBe(false);
    expect(drift.missingFromReadme).toContain("check:fast");
  });

  test("patchReadmeScripts inserts missing rows", async () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { alpha: "echo a", beta: "echo b" } }, null, 2)
    );
    writeFileSync(
      join(tmpDir, "README.md"),
      "### Project Scripts\n\n| `bun run alpha` | A |\n\n### Governance\n"
    );

    const patched = await patchReadmeScripts(tmpDir);
    expect(patched).toBe(1);

    const after = await checkDocDrift(tmpDir);
    expect(after.fresh).toBe(true);

    const readme = await Bun.file(join(tmpDir, "README.md")).text();
    expect(readme).toContain("bun run beta");
  });
});
