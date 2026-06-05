import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { computeSyncHashes, detectSyncDrift } from "../src/lib/sync-hashes.ts";

const REPO_ROOT = import.meta.dir + "/..";

describe("sync-drift", () => {
  let prevHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    prevHome = Bun.env.HOME;
    tmpHome = join(REPO_ROOT, `.tmp-drift-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpHome, { recursive: true });
    Bun.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (prevHome) Bun.env.HOME = prevHome;
    if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true });
  });

  test("detectSyncDrift reports missing when desktop is empty", async () => {
    const report = await detectSyncDrift(REPO_ROOT);
    expect(report.synced).toBe(false);
    expect(report.missing.length).toBeGreaterThan(0);
    expect(report.drifted).toEqual([]);
  });

  test("detectSyncDrift reports synced when desktop matches repo", async () => {
    const hashes = await computeSyncHashes(REPO_ROOT);
    const key = "lib/r-score.ts";
    expect(hashes[key]).toBeTruthy();

    const desktopLib = join(tmpHome, ".kimi-code", "lib");
    mkdirSync(desktopLib, { recursive: true });
    writeFileSync(
      join(desktopLib, "r-score.ts"),
      await Bun.file(join(REPO_ROOT, "src/lib/r-score.ts")).text()
    );

    const report = await detectSyncDrift(REPO_ROOT);
    expect(report.drifted).not.toContain(key);
    expect(report.missing).not.toContain(key);
  });

  test("detectSyncDrift reports drift when desktop file differs", async () => {
    const desktopLib = join(tmpHome, ".kimi-code", "lib");
    mkdirSync(desktopLib, { recursive: true });
    writeFileSync(join(desktopLib, "r-score.ts"), "// stale content\n");

    const report = await detectSyncDrift(REPO_ROOT);
    expect(report.drifted).toContain("lib/r-score.ts");
    expect(report.synced).toBe(false);
  });
});
