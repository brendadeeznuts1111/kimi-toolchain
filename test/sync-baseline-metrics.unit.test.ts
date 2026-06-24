import { describe, expect, test } from "bun:test";
import { join } from "path";
import { hashArchive } from "../src/lib/archive-persistence.ts";
import { makeDir } from "../src/lib/bun-io.ts";
import {
  readSyncBaselineHistory,
  readSyncBaselineMetricsWithDrift,
  recordSyncBaselineMetrics,
} from "../src/lib/sync-baseline-metrics.ts";
import { syncBaselineHistoryPath, syncBaselineMetricsPath } from "../src/lib/paths.ts";
import { cleanupPath, testTempDir, withEnv, withIsolatedHome } from "./helpers.ts";

describe("sync-baseline-metrics", () => {
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
