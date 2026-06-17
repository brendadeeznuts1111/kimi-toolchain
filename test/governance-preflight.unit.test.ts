import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  isLockfileMtimeStale,
  lockfileNeedsGuardianBaseline,
  refreshStaleLockfile,
  runGovernancePreflight,
} from "../src/lib/governance-preflight.ts";

let tmpHome: string;
let projectDir: string;
let previousHome: string | undefined;

describe("governance-preflight", () => {
  beforeEach(() => {
    previousHome = Bun.env.HOME;
    tmpHome = join(tmpdir(), `gov-preflight-${Bun.randomUUIDv7()}`);
    mkdirSync(join(tmpHome, ".kimi-code", "guardian"), { recursive: true });
    Bun.env.HOME = tmpHome;

    projectDir = join(tmpHome, "project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "bun.lock"), "# lock\n");
    writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "demo", scripts: {} }));
    writeFileSync(join(projectDir, "README.md"), "# demo\n");
  });

  afterEach(() => {
    if (previousHome === undefined) delete Bun.env.HOME;
    else Bun.env.HOME = previousHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  test("isLockfileMtimeStale when package.json is newer than bun.lock", async () => {
    expect(isLockfileMtimeStale(projectDir)).toBe(false);
    await Bun.sleep(15);
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "demo", scripts: { lint: "oxlint ." } })
    );
    expect(isLockfileMtimeStale(projectDir)).toBe(true);
  });

  test("refreshStaleLockfile returns true and clears mtime stale", async () => {
    await Bun.sleep(15);
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "demo", scripts: { test: "bun test" } })
    );
    const refreshed = await refreshStaleLockfile(projectDir);
    expect(refreshed).toBe(true);
    expect(isLockfileMtimeStale(projectDir)).toBe(false);
  });

  test("lockfileNeedsGuardianBaseline when hash file is missing", async () => {
    expect(await lockfileNeedsGuardianBaseline(projectDir)).toBe(true);
  });

  test("runGovernancePreflight with guardian disabled can no-op", async () => {
    const report = await runGovernancePreflight(projectDir, { guardian: false });
    expect(report.actions).toEqual([]);
    expect(report.changed).toBe(false);
  });
});
