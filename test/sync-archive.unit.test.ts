import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { createSyncSnapshotArchive, hashArchive } from "../src/lib/archive-persistence.ts";
import {
  detectSyncDrift,
  finalizeSyncArchive,
  readSyncBaselineHistory,
  readSyncBaselineMetricsWithDrift,
  recordSyncBaselineMetrics,
  restoreSyncBaseline,
  syncDesktop,
} from "../src/lib/desktop-sync.ts";
import {
  syncBaselineCacheArchivePath,
  syncBaselineHistoryPath,
  syncBaselineMetricsPath,
} from "../src/lib/paths.ts";
import {
  cleanupPath,
  REPO_ROOT,
  testTempDir,
  withEnv,
  withIsolatedHome,
  makeDir,
  writeText,
} from "./helpers.ts";

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
    const { join } = await import("path");
    const { desktopRoot } = await import("../src/lib/paths.ts");
    makeDir(join(desktopRoot(), "lib"), { recursive: true });
    writeText(join(desktopRoot(), "lib", "r-score.ts"), "// stale\n");
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

  test("recordSyncBaselineMetrics tracks hash and size drift across runs", async () => {
    await withIsolatedHome(async () => {
      const metricsPath = syncBaselineMetricsPath();
      if (await Bun.file(metricsPath).exists()) await Bun.file(metricsPath).delete();

      const repoRoot = testTempDir("sync-metrics-repo");
      const cacheDir = join(repoRoot, ".cache");
      makeDir(cacheDir, { recursive: true });
      const archivePath = join(cacheDir, "sync-baseline.tar.gz");

      await withEnv({ BUN_INSTALL_CACHE_DIR: cacheDir }, async () => {
        const bytes1 = new Uint8Array(100);
        bytes1.fill(1);
        await Bun.write(archivePath, bytes1);
        const hash1 = hashArchive(bytes1);
        const first = await recordSyncBaselineMetrics(repoRoot, {
          ok: true,
          archivePath,
          syncBaselineSize: 100,
          syncBaselineHash: hash1,
          fileCount: 1,
          toolchainVersion: "1.0.0",
          lastSyncedAt: "2026-06-23T12:00:00.000Z",
        });
        expect(first?.hashChanged).toBe(false);

        const bytes2 = new Uint8Array(120);
        bytes2.fill(2);
        await Bun.write(archivePath, bytes2);
        const hash2 = hashArchive(bytes2);
        const second = await recordSyncBaselineMetrics(repoRoot, {
          ok: true,
          archivePath,
          syncBaselineSize: 120,
          syncBaselineHash: hash2,
          fileCount: 2,
          toolchainVersion: "1.0.0",
          lastSyncedAt: "2026-06-23T12:05:00.000Z",
        });
        expect(second?.hashChanged).toBe(true);
        expect(second?.sizeDelta).toBe(20);
        expect(second?.previousSyncBaselineHash).toBe(hash1);

        const view = await readSyncBaselineMetricsWithDrift(repoRoot);
        expect(view.syncBaselineHash).toBe(hash2);
        expect(view.history.sizes).toEqual([100, 120]);
        expect(view.history.driftCounts).toEqual([0, 1]);
        expect(await Bun.file(syncBaselineMetricsPath()).exists()).toBe(true);
        const history = await readSyncBaselineHistory(repoRoot);
        expect(history.sizes).toEqual([100, 120]);
        expect(await Bun.file(syncBaselineHistoryPath(repoRoot)).exists()).toBe(true);
      });

      cleanupPath(repoRoot);
    });
  });
});
