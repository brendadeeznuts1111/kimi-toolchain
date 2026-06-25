import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSyncSnapshotArchive } from "../src/lib/archive-persistence.ts";
import { syncDesktop } from "../src/lib/desktop-sync.ts";
import { syncBaselineCacheArchivePath } from "../src/lib/paths.ts";
import { detectSyncDrift, finalizeSyncArchive, restoreSyncBaseline } from "../src/lib/desktop-sync.ts";
import { cleanupPath, REPO_ROOT, testTempDir } from "./helpers.ts";

describe.serial("sync-archive", () => {
  let previousHome: string | undefined;
  let testHome: string;

  beforeEach(() => {
    previousHome = Bun.env.HOME;
    testHome = testTempDir("sync-archive-home");
    Bun.env.HOME = testHome;
  });

  afterEach(() => {
    if (previousHome) Bun.env.HOME = previousHome;
    else delete Bun.env.HOME;
    cleanupPath(testHome);
  });

  test("detectSyncDrift reports drift when desktop file differs", async () => {
    const { mkdirSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const { desktopRoot } = await import("../src/lib/paths.ts");
    mkdirSync(join(desktopRoot(), "lib"), { recursive: true });
    writeFileSync(join(desktopRoot(), "lib", "r-score.ts"), "// stale\n");
    const report = await detectSyncDrift(REPO_ROOT);
    expect(report.drifted).toContain("lib/r-score.ts");
  });

  test("finalizeSyncArchive writes baseline when writeArchive is true", async () => {
    await syncDesktop(REPO_ROOT, { force: true });
    const archivePath = syncBaselineCacheArchivePath(REPO_ROOT);
    const skipped = await finalizeSyncArchive(REPO_ROOT, {
      files: ["sync-test"],
      writeArchive: false,
    });
    expect(skipped.archived).toBe(false);

    const result = await finalizeSyncArchive(REPO_ROOT, {
      files: ["sync-test"],
      archivePath,
      writeArchive: true,
    });
    expect(result.archived).toBe(true);
    expect(result.archiveHash).toMatch(/^[0-9a-f]{8}$/);
    expect(await Bun.file(archivePath).exists()).toBe(true);
  });

  test("restoreSyncBaseline rejects stale archive hashes", async () => {
    await syncDesktop(REPO_ROOT, { force: true });
    const archivePath = syncBaselineCacheArchivePath(REPO_ROOT);
    const { manifest } = await finalizeSyncArchive(REPO_ROOT, {
      files: ["drift-test"],
      archivePath,
      writeArchive: true,
    });

    await Bun.write(
      archivePath,
      await createSyncSnapshotArchive({
        ...manifest,
        fileHashes: { ...manifest.fileHashes, "lib/r-score.ts": "f".repeat(64) },
      })
    );

    await expect(
      restoreSyncBaseline({ repoRoot: REPO_ROOT, archivePath, verify: true, dryRun: true })
    ).rejects.toThrow(/Baseline drift detected/);
  });
});