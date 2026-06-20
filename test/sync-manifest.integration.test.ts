import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { artifactPath } from "../src/lib/artifacts.ts";
import { desktopRoot, syncDesktop } from "../src/lib/desktop-sync.ts";
import { writeSyncManifest, verifySyncManifest } from "../src/lib/sync-manifest.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("sync-manifest", () => {
  let previousHome: string | undefined;
  let testHome: string;

  beforeEach(() => {
    previousHome = Bun.env.HOME;
    testHome = artifactPath(
      REPO_ROOT,
      "tmp",
      `sync-manifest-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testHome, { recursive: true });
    Bun.env.HOME = testHome;
  });

  afterEach(() => {
    if (previousHome) Bun.env.HOME = previousHome;
    else delete Bun.env.HOME;
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
  });

  test("writes a manifest with hashes and verifies the synced desktop copy", async () => {
    await syncDesktop(REPO_ROOT, { force: true });

    const manifest = await writeSyncManifest(REPO_ROOT, { files: ["test"] });
    const report = await verifySyncManifest(REPO_ROOT);

    expect(manifest.fileHashes?.["lib/r-score.ts"]).toMatch(/^[a-f0-9]{64}$/);
    expect(report.ok).toBe(true);
    expect(report.manifestFresh).toBe(true);
    expect(report.desktopSynced).toBe(true);
  });

  test("verification fails when the desktop copy drifts after manifest generation", async () => {
    await syncDesktop(REPO_ROOT, { force: true });
    await writeSyncManifest(REPO_ROOT);
    await Bun.write(join(desktopRoot(), "lib", "r-score.ts"), "// stale\n");

    const report = await verifySyncManifest(REPO_ROOT);

    expect(report.ok).toBe(false);
    expect(report.manifestFresh).toBe(true);
    expect(report.desktopSynced).toBe(false);
    expect(report.drift.drifted).toContain("lib/r-score.ts");
  });
});
