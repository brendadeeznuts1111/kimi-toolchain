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

const DEMO_PKG = {
  name: "demo",
  dependencies: { "js-yaml": "4.2.0" },
  scripts: {} as Record<string, string>,
};

/** Valid lock for DEMO_PKG — frozen `bun install` succeeds on scripts-only package.json edits. */
const DEMO_LOCK = `{
  "lockfileVersion": 2,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "demo",
      "dependencies": {
        "js-yaml": "4.2.0",
      },
    },
  },
  "packages": {
    "argparse": ["argparse@2.0.1", "", {}, "sha512-8+9WqebbFzpX9OR+Wa6O29asIogeRMzcGtAINdpMHHyAg10f05aSFVBbcEqGf/PXw1EjAZ+q2/bEBg3DvurK3Q=="],

    "js-yaml": ["js-yaml@4.2.0", "", { "dependencies": { "argparse": "^2.0.1" }, "bin": { "js-yaml": "bin/js-yaml.js" } }, "sha512-ePWsvanv0DWuDRsW8dnt+R4jQ31SCRCQ7hhNcPXZPsoBZiemuZNYGf7adZdqX2D86j6rvKp3RpCxVTSb8WQlOw=="],
  }
}
`;

function withPreflightHome<T>(
  fn: (ctx: { tmpHome: string; projectDir: string }) => T | Promise<T>
) {
  const tmpHome = testTempDir("gov-preflight-");
  makeDir(join(tmpHome, ".kimi-code", "guardian"), { recursive: true });
  const projectDir = join(tmpHome, "project");
  makeDir(projectDir, { recursive: true });
  writeText(join(projectDir, "package.json"), JSON.stringify(DEMO_PKG));
  writeText(join(projectDir, "bun.lock"), DEMO_LOCK);
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
        JSON.stringify({ ...DEMO_PKG, scripts: { lint: "oxlint ." } })
      );
      expect(isLockfileMtimeStale(projectDir)).toBe(true);
    });
  });

  test("refreshStaleLockfile returns true and clears mtime stale", async () => {
    await withPreflightHome(async ({ projectDir }) => {
      await Bun.sleep(15);
      writeText(
        join(projectDir, "package.json"),
        JSON.stringify({ ...DEMO_PKG, scripts: { test: "bun test" } })
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
