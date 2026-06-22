import { describe, expect, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT } from "../helpers.ts";
import { invokeTool } from "../../src/lib/tool-runner.ts";
import { removePath, writeText } from "../../src/lib/bun-io.ts";
import { testTempDir } from "../helpers.ts";

const CHECK_ENV_DRIFT = join(REPO_ROOT, "scripts/check-env-drift.ts");

describe("check-env-drift smoke", () => {
  test("reports human-readable in-sync status", async () => {
    const result = await invokeTool(CHECK_ENV_DRIFT, [], {
      cwd: REPO_ROOT,
      timeoutMs: 15_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(".env drift check");
    expect(result.stdout).toContain("in sync with .env.example");
  }, 15_000);

  test("reports JSON in-sync status", async () => {
    const result = await invokeTool(CHECK_ENV_DRIFT, ["--json"], {
      cwd: REPO_ROOT,
      timeoutMs: 15_000,
    });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.trim()) as {
      exampleOnly: string[];
      localOnly: string[];
      exampleTotal: number;
      localTotal: number;
    };
    expect(report.exampleOnly).toEqual([]);
    expect(report.localOnly).toEqual([]);
    expect(report.exampleTotal).toBeGreaterThan(0);
    expect(report.localTotal).toBeGreaterThan(0);
  }, 15_000);

  test("--fix appends missing keys in a temp project", async () => {
    const root = testTempDir("check-env-drift-fix-");
    const examplePath = join(root, ".env.example");
    const localPath = join(root, ".env");

    try {
      await writeText(examplePath, "# App config\nAPI_KEY=xxx\n\n# Server config\nPORT=3000\n");
      await writeText(localPath, "API_KEY=yyy\n");

      const result = await invokeTool(CHECK_ENV_DRIFT, ["--fix"], {
        cwd: root,
        timeoutMs: 15_000,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Synchronized 1 missing key(s)");

      const localText = await Bun.file(localPath).text();
      expect(localText).toContain("API_KEY=yyy");
      expect(localText).toContain("PORT=3000");
      expect(localText).toContain("Synchronized from .env.example");
    } finally {
      removePath(root, { recursive: true, force: true });
    }
  }, 15_000);

  test("skips gracefully when .env is missing", async () => {
    const root = testTempDir("check-env-drift-missing-");
    const examplePath = join(root, ".env.example");

    try {
      await writeText(examplePath, "API_KEY=xxx\n");

      const result = await invokeTool(CHECK_ENV_DRIFT, [], {
        cwd: root,
        timeoutMs: 15_000,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No .env file to check");
    } finally {
      removePath(root, { recursive: true, force: true });
    }
  }, 15_000);
});
