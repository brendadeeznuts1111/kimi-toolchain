import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir } from "../src/lib/bun-io.ts";
import {
  createSyncSnapshotArchive,
  extractSyncSnapshotArchive,
} from "../src/lib/archive-persistence.ts";
import { syncDesktop } from "../src/lib/desktop-sync.ts";
import { syncBaselineArchivePath, syncBaselineCacheArchivePath } from "../src/lib/paths.ts";
import { restoreSyncBaseline } from "../src/lib/restore-baseline.ts";
import { finalizeSyncArchive } from "../src/harness/sync.ts";
import { verifySyncManifest, writeSyncManifestWithArchive } from "../src/lib/sync-manifest.ts";
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

  test("syncBaselineCacheArchivePath expands tilde in BUN_INSTALL_CACHE_DIR", () => {
    const previous = Bun.env.BUN_INSTALL_CACHE_DIR;
    Bun.env.BUN_INSTALL_CACHE_DIR = "~/.bun/install/cache";
    try {
      expect(syncBaselineCacheArchivePath(REPO_ROOT)).toBe(
        join(testHome, ".bun", "install", "cache", "sync-baseline.tar.gz")
      );
    } finally {
      if (previous === undefined) delete Bun.env.BUN_INSTALL_CACHE_DIR;
      else Bun.env.BUN_INSTALL_CACHE_DIR = previous;
    }
  });

  test("writeSyncManifestWithArchive round-trips manifest and file hashes", async () => {
    await syncDesktop(REPO_ROOT, { force: true });

    const archivePath = syncBaselineArchivePath();
    const { manifest, archiveHash, byteLength } = await writeSyncManifestWithArchive(
      REPO_ROOT,
      archivePath,
      { files: ["test"] }
    );

    expect(archiveHash).toMatch(/^[0-9a-f]{8}$/);
    expect(byteLength).toBeGreaterThan(0);
    expect(await Bun.file(archivePath).exists()).toBe(true);

    const extractDir = join(testHome, "extracted");
    makeDir(extractDir, { recursive: true });
    const extracted = await extractSyncSnapshotArchive(
      await Bun.file(archivePath).bytes(),
      extractDir
    );

    expect(extracted.manifest.toolchainVersion).toBe(manifest.toolchainVersion);
    expect(extracted.manifest.fileHashes).toEqual(manifest.fileHashes ?? {});
    expect(extracted.fileHashes).toEqual(manifest.fileHashes ?? {});
  });

  test("finalizeSyncArchive writes baseline by default and respects writeArchive: false", async () => {
    await syncDesktop(REPO_ROOT, { force: true });

    const { resolveArchiveMode, shouldWriteArchive, syncBaselineCacheArchivePath } =
      await import("../src/harness/sync.ts");
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
    expect(resolveArchiveMode(["bun", "sync"])).toBe("auto");
    expect(resolveArchiveMode(["bun", "sync", "--no-archive"])).toBe("never");
    expect(resolveArchiveMode(["bun", "sync", "--archive=always"])).toBe("always");
    expect(await shouldWriteArchive(REPO_ROOT, ["bun", "sync", "--archive=never"])).toBe(false);
    expect(await shouldWriteArchive(REPO_ROOT, ["bun", "sync", "--archive=always"])).toBe(true);
  });

  test("restoreSyncBaseline writes manifest and verifySyncManifest passes", async () => {
    await syncDesktop(REPO_ROOT, { force: true });
    const { syncBaselineCacheArchivePath } = await import("../src/harness/sync.ts");
    await finalizeSyncArchive(REPO_ROOT, {
      files: ["restore-test"],
      archivePath: syncBaselineCacheArchivePath(REPO_ROOT),
      writeArchive: true,
    });

    const restored = await restoreSyncBaseline({
      repoRoot: REPO_ROOT,
      archivePath: syncBaselineCacheArchivePath(REPO_ROOT),
      verify: true,
      dryRun: false,
    });

    expect(restored.wroteManifest).toBe(true);
    const report = await verifySyncManifest(REPO_ROOT);
    expect(report.ok).toBe(true);
  });

  test("restoreSyncBaseline verify fails when archive hashes are stale", async () => {
    await syncDesktop(REPO_ROOT, { force: true });
    const { syncBaselineCacheArchivePath } = await import("../src/harness/sync.ts");
    const { manifest } = await finalizeSyncArchive(REPO_ROOT, {
      files: ["drift-test"],
      archivePath: syncBaselineCacheArchivePath(REPO_ROOT),
      writeArchive: true,
    });

    const staleManifest = {
      ...manifest,
      fileHashes: {
        ...manifest.fileHashes,
        "lib/r-score.ts": "f".repeat(64),
      },
    };
    const archivePath = syncBaselineCacheArchivePath(REPO_ROOT);
    await Bun.write(archivePath, await createSyncSnapshotArchive(staleManifest));

    await expect(
      restoreSyncBaseline({
        repoRoot: REPO_ROOT,
        archivePath,
        verify: true,
        dryRun: true,
      })
    ).rejects.toThrow(/Baseline drift detected/);
  });
});
