import { makeDir, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { cleanupPath, testTempDir, withEnv } from "./helpers.ts";
import {
  isLockfileMtimeStale,
  lockfileNeedsGuardianBaseline,
  refreshStaleLockfile,
  runGovernancePreflight,
} from "../src/lib/governance-preflight.ts";

function withPreflightHome<T>(
  fn: (ctx: { tmpHome: string; projectDir: string }) => T | Promise<T>
) {
  const tmpHome = testTempDir("gov-preflight-");
  makeDir(join(tmpHome, ".kimi-code", "guardian"), { recursive: true });
  const projectDir = join(tmpHome, "project");
  makeDir(projectDir, { recursive: true });
  writeText(join(projectDir, "bun.lock"), "# lock\n");
  writeText(join(projectDir, "package.json"), JSON.stringify({ name: "demo", scripts: {} }));
  writeText(join(projectDir, "README.md"), "# demo\n");

  return withEnv({ HOME: tmpHome }, () => {
    const ctx = { tmpHome, projectDir };
    function cleanup() {
      cleanupPath(tmpHome);
    }
    try {
      const result = fn(ctx);
      if (result instanceof Promise) {
        return result.finally(cleanup) as T | Promise<T>;
      }
      cleanup();
      return result;
    } catch (error) {
      cleanup();
      throw error;
    }
  });
}

describe("governance-preflight", () => {
  test("isLockfileMtimeStale when package.json is newer than bun.lock", async () => {
    await withPreflightHome(async ({ projectDir }) => {
      expect(isLockfileMtimeStale(projectDir)).toBe(false);
      await Bun.sleep(15);
      writeText(
        join(projectDir, "package.json"),
        JSON.stringify({ name: "demo", scripts: { lint: "oxlint ." } })
      );
      expect(isLockfileMtimeStale(projectDir)).toBe(true);
    });
  });

  test("refreshStaleLockfile returns true and clears mtime stale", async () => {
    await withPreflightHome(async ({ projectDir }) => {
      await Bun.sleep(15);
      writeText(
        join(projectDir, "package.json"),
        JSON.stringify({ name: "demo", scripts: { test: "bun test" } })
      );
      const refreshed = await refreshStaleLockfile(projectDir);
      expect(refreshed).toBe(true);
      expect(isLockfileMtimeStale(projectDir)).toBe(false);
    });
  });

  test("lockfileNeedsGuardianBaseline when hash file is missing", async () => {
    await withPreflightHome(async ({ projectDir }) => {
      expect(await lockfileNeedsGuardianBaseline(projectDir)).toBe(true);
    });
  });

  test("runGovernancePreflight with guardian disabled can no-op", async () => {
    await withPreflightHome(async ({ projectDir }) => {
      const report = await runGovernancePreflight(projectDir, { guardian: false });
      expect(report.actions).toEqual([]);
      expect(report.changed).toBe(false);
    });
  });
});
