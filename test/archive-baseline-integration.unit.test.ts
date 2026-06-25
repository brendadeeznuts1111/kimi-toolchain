import { describe, expect, test } from "bun:test";
import { join } from "path";
import { writeSyncSnapshotArchive } from "../src/lib/archive-persistence.ts";
import {
  dryRunRestoreBaseline,
  finalizeSyncArchive,
  syncDesktop,
} from "../src/lib/desktop-sync.ts";
import { restoreBaseline } from "../src/profile/commands/restore-baseline.ts";
import { syncBaselineCacheArchivePath } from "../src/lib/paths.ts";
import { REPO_ROOT } from "./helpers.ts";
import { sha256String } from "../src/lib/utils.ts";
import type { ToolchainManifest } from "../src/lib/version.ts";
import { withIsolatedHome, withTempDir } from "./helpers.ts";

describe.serial("archive-baseline-integration", () => {
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

  test("restoreBaseline extract dry-run skips writes", async () => {
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
});
