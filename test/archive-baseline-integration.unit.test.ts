import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  extractSyncSnapshotArchive,
  writeSyncSnapshotArchive,
} from "../src/lib/archive-persistence.ts";
import { dryRunRestoreBaseline, hashDiffTableRows } from "../src/lib/restore-baseline.ts";
import { readSyncBaselineMetrics } from "../src/lib/sync-baseline-metrics.ts";
import { restoreBaseline } from "../src/profile/commands/restore-baseline.ts";
import { syncDesktop } from "../src/lib/desktop-sync.ts";
import { finalizeSyncArchive } from "../src/harness/sync.ts";
import { syncBaselineCacheArchivePath } from "../src/lib/paths.ts";
import { REPO_ROOT } from "./helpers.ts";
import { makeDir } from "../src/lib/bun-io.ts";
import { sha256String } from "../src/lib/utils.ts";
import { writeSyncManifestWithArchive } from "../src/lib/sync-manifest.ts";
import type { ToolchainManifest } from "../src/lib/version.ts";
import { withIsolatedHome, withTempDir } from "./helpers.ts";

describe("archive-baseline-integration", () => {
  test("hashDiffTableRows maps add/remove/modify for dry-run table", () => {
    const rows = hashDiffTableRows({
      missing: ["lib/old.ts"],
      changed: ["lib/utils.ts"],
      extra: ["lib/new.ts"],
    });
    expect(rows).toEqual([
      { file: "lib/new.ts", status: "add" },
      { file: "lib/old.ts", status: "remove" },
      { file: "lib/utils.ts", status: "modify" },
    ]);
  });

  test("dryRunRestoreBaseline diffs in-memory without writing", async () => {
    await withIsolatedHome(async () => {
      await syncDesktop(REPO_ROOT, { force: true });
      const archivePath = syncBaselineCacheArchivePath(REPO_ROOT);
      await finalizeSyncArchive(REPO_ROOT, {
        files: ["dry-run-test"],
        archivePath,
        writeArchive: true,
      });

      const preview = await dryRunRestoreBaseline(archivePath, REPO_ROOT);
      expect(preview.ok).toBe(true);
      expect(preview.driftRows).toEqual([]);
    });
  });

  test("readSyncBaselineMetrics reports size and hash when archive exists", async () => {
    await withIsolatedHome(async () => {
      await syncDesktop(REPO_ROOT, { force: true });
      const archivePath = syncBaselineCacheArchivePath(REPO_ROOT);
      await finalizeSyncArchive(REPO_ROOT, {
        files: ["metrics-test"],
        archivePath,
        writeArchive: true,
      });

      const metrics = await readSyncBaselineMetrics(REPO_ROOT);
      expect(metrics.ok).toBe(true);
      expect(metrics.archivePath).toBe(archivePath);
      expect(metrics.syncBaselineSize).toBeGreaterThan(0);
      expect(metrics.syncBaselineHash).toMatch(/^[0-9a-f]{8}$/);
      expect(metrics.fileCount).toBeGreaterThan(0);
    });
  });

  test("writeSyncManifestWithArchive includes sync-managed file payloads", async () => {
    await withTempDir("archive-baseline-repo", async (repoRoot) => {
      await withIsolatedHome(async () => {
        makeDir(join(repoRoot, "src/bin"), { recursive: true });
        makeDir(join(repoRoot, "src/lib"), { recursive: true });
        makeDir(join(repoRoot, "scripts"), { recursive: true });
        await Bun.write(join(repoRoot, "src/bin/kimi-demo.ts"), "console.log('demo');\n");
        await Bun.write(join(repoRoot, "src/lib/demo.ts"), "export const demo = true;\n");
        await Bun.write(join(repoRoot, "scripts/demo.ts"), "console.log('script');\n");

        const archivePath = join(repoRoot, "out", "sync-baseline.tar.gz");
        const { byteLength, archiveHash } = await writeSyncManifestWithArchive(
          repoRoot,
          archivePath
        );

        expect(byteLength).toBeGreaterThan(0);
        expect(archiveHash).toMatch(/^[0-9a-f]{8}$/);

        const extracted = await extractSyncSnapshotArchive(
          await Bun.file(archivePath).bytes(),
          join(repoRoot, "restore")
        );

        expect(extracted.files).toContain("tools/kimi-demo.ts");
        expect(extracted.files).toContain("lib/demo.ts");
        expect(extracted.files).toContain("scripts/demo.ts");
        expect(await Bun.file(join(repoRoot, "restore/tools/kimi-demo.ts")).text()).toBe(
          "console.log('demo');\n"
        );
      });
    });
  });

  test("restoreBaseline verifies extracted files without writing on dry run", async () => {
    await withTempDir("archive-baseline-restore", async (dir) => {
      const manifest: ToolchainManifest = {
        toolchainVersion: "1.2.3",
        desktopVersion: null,
        gitHead: "abc123",
        lastSyncedAt: "2026-06-23T12:00:00.000Z",
        files: ["tools/demo.ts"],
        fileHashes: {
          "tools/demo.ts": sha256String("console.log('restore');\n"),
        },
      };
      const archivePath = join(dir, "sync-baseline.tar.gz");
      await writeSyncSnapshotArchive(manifest, archivePath, {
        "tools/demo.ts": "console.log('restore');\n",
      });

      const targetDir = join(dir, "target");
      const result = await restoreBaseline({
        archivePath,
        repoRoot: dir,
        mode: "extract",
        targetDir,
        verify: true,
        dryRun: true,
        json: false,
      });

      expect(result.restoredFiles).toEqual(["tools/demo.ts"]);
      expect(await Bun.file(join(targetDir, "tools/demo.ts")).exists()).toBe(false);
    });
  });

  test("restoreBaseline manifest mode delegates to restoreSyncBaseline", async () => {
    await withIsolatedHome(async () => {
      await syncDesktop(REPO_ROOT, { force: true });
      const archivePath = syncBaselineCacheArchivePath(REPO_ROOT);
      await finalizeSyncArchive(REPO_ROOT, {
        files: ["profile-restore-test"],
        archivePath,
        writeArchive: true,
      });

      const result = await restoreBaseline({
        archivePath,
        repoRoot: REPO_ROOT,
        mode: "manifest",
        targetDir: ".",
        verify: true,
        dryRun: false,
        json: false,
      });

      expect(result.mode).toBe("manifest");
      expect(result.wroteManifest).toBe(true);
      expect(result.manifestVerificationOk).toBe(true);
    });
  });

  test("restoreBaseline --force skips hash verification", async () => {
    await withTempDir("archive-baseline-force", async (dir) => {
      const manifest: ToolchainManifest = {
        toolchainVersion: "1.2.3",
        desktopVersion: null,
        gitHead: "abc123",
        lastSyncedAt: "2026-06-23T12:00:00.000Z",
        files: ["tools/demo.ts"],
        fileHashes: {
          "tools/demo.ts": "f".repeat(64),
        },
      };
      const archivePath = join(dir, "sync-baseline.tar.gz");
      await writeSyncSnapshotArchive(manifest, archivePath, {
        "tools/demo.ts": "console.log('force');\n",
      });

      const targetDir = join(dir, "target");
      const result = await restoreBaseline({
        archivePath,
        repoRoot: dir,
        mode: "extract",
        targetDir,
        verify: false,
        dryRun: false,
        json: false,
      });

      expect(result.verified).toBe(false);
      expect(result.restored).toBe(1);
      expect(await Bun.file(join(targetDir, "tools/demo.ts")).text()).toBe(
        "console.log('force');\n"
      );
    });
  });
});
