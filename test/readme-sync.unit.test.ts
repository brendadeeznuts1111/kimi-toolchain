import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { checkDocDrift, patchReadmeScripts, runReadmeSyncCli } from "../src/lib/readme-sync.ts";

const REPO_ROOT = import.meta.dir + "/..";
let tmpDir: string;
let consoleSpy: ReturnType<typeof spyOn> | undefined;

function captureConsole() {
  const logs: string[] = [];
  consoleSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  return logs;
}

describe("readme-sync", () => {
  beforeEach(() => {
    tmpDir = join(REPO_ROOT, `.tmp-readme-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    consoleSpy?.mockRestore();
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

  test("checkDocDrift returns stale when README missing", async () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
    const drift = await checkDocDrift(tmpDir);
    expect(drift.fresh).toBe(false);
    expect(drift.readmeScripts).toEqual([]);
  });

  test("checkDocDrift finds script keys in code blocks without bun run prefix", async () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { serve: "bun run src/server.ts" } }, null, 2)
    );
    writeFileSync(join(tmpDir, "README.md"), "## Run\n\n```bash\n# start serve\nserve\n```\n");
    const drift = await checkDocDrift(tmpDir);
    expect(drift.readmeScripts).toContain("serve");
    expect(drift.fresh).toBe(true);
  });

  test("checkDocDrift finds scripts mentioned in code blocks", async () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { dev: "bun run src/index.ts", build: "bun build" } }, null, 2)
    );
    writeFileSync(
      join(tmpDir, "README.md"),
      "## Dev\n\n```bash\nbun run dev\nbun run build\n```\n"
    );
    const drift = await checkDocDrift(tmpDir);
    expect(drift.readmeScripts).toContain("dev");
    expect(drift.readmeScripts).toContain("build");
    expect(drift.fresh).toBe(true);
  });

  test("checkDocDrift flags extra scripts in README", async () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
    writeFileSync(join(tmpDir, "README.md"), "Run `bun run test` and `bun run removed-script`");
    const drift = await checkDocDrift(tmpDir);
    expect(drift.extraInReadme).toContain("removed-script");
    expect(drift.fresh).toBe(false);
  });

  test("patchReadmeScripts appends when no markdown subsection", async () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { only: "echo", missing: "echo 2" } }, null, 2)
    );
    writeFileSync(join(tmpDir, "README.md"), "| `bun run only` | ok |\n");

    const patched = await patchReadmeScripts(tmpDir);
    expect(patched).toBe(1);
    const readme = await Bun.file(join(tmpDir, "README.md")).text();
    expect(readme).toContain("bun run missing");
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

  test("CLI --fix patches drift", async () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { cli: "echo cli" } }, null, 2)
    );
    writeFileSync(join(tmpDir, "README.md"), "# Project\n");

    const logs = captureConsole();
    expect(await runReadmeSyncCli(["--fix", tmpDir])).toBe(0);
    expect(logs.join("\n")).toContain("Patched README.md");
    const drift = await checkDocDrift(tmpDir);
    expect(drift.fresh).toBe(true);
  });

  test("CLI reports in sync without --fix", async () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { test: "bun test" } }, null, 2)
    );
    writeFileSync(join(tmpDir, "README.md"), "Run `bun run test` for tests.\n");

    const logs = captureConsole();
    expect(await runReadmeSyncCli([tmpDir])).toBe(0);
    expect(logs.join("\n")).toContain("in sync");
  });

  test("CLI exits 1 and lists drift without --fix", async () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { missing: "echo" } }, null, 2)
    );
    writeFileSync(join(tmpDir, "README.md"), "Also `bun run ghost`.\n");

    const logs = captureConsole();
    expect(await runReadmeSyncCli([tmpDir])).toBe(1);
    expect(logs.join("\n")).toContain("Missing from README: missing");
    expect(logs.join("\n")).toContain("Extra in README: ghost");
  });

  test("CLI --fix reports already synced", async () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { test: "bun test" } }, null, 2)
    );
    writeFileSync(join(tmpDir, "README.md"), "`bun run test`\n");

    const logs = captureConsole();
    expect(await runReadmeSyncCli(["--fix", tmpDir])).toBe(0);
    expect(logs.join("\n")).toContain("already in sync");
  });

  test("CLI reports failure on invalid package.json", async () => {
    writeFileSync(join(tmpDir, "README.md"), "# Project\n");
    writeFileSync(join(tmpDir, "package.json"), "not-json");

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    expect(await runReadmeSyncCli([tmpDir])).toBe(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain("readme-sync failed");
    errorSpy.mockRestore();
  });
});
