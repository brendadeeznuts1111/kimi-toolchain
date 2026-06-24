import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  archiveSupported,
  buildDistFileHashMap,
  createDistArchive,
  createSyncSnapshotArchive,
  diffDistArchives,
  extractSyncSnapshotArchive,
  hashArchive,
  readSyncSnapshotArchiveMetadata,
  SYNC_SNAPSHOT_META_FILES,
} from "../src/lib/archive-persistence.ts";
import type { ToolchainManifest } from "../src/lib/version.ts";
import { withTempDir } from "./helpers.ts";

describe("archive-persistence", () => {
  test("archiveSupported is true on current Bun", () => {
    expect(archiveSupported()).toBe(true);
  });

  test("extractSyncSnapshotArchive respects extract glob filter", async () => {
    const manifest: ToolchainManifest = {
      toolchainVersion: "1.0.0",
      desktopVersion: null,
      gitHead: null,
      lastSyncedAt: "2026-06-23T12:00:00.000Z",
      files: ["lib/a.ts", "lib/b.ts"],
      fileHashes: { "lib/a.ts": "a", "lib/b.ts": "b" },
    };
    const bytes = await createSyncSnapshotArchive(manifest, {
      "lib/a.ts": "a\n",
      "lib/b.ts": "b\n",
    });

    await withTempDir("archive-glob", async (dir) => {
      const outDir = join(dir, "out");
      const extracted = await extractSyncSnapshotArchive(bytes, outDir, {
        glob: ["**/*.json"],
      });
      expect(extracted.files).toEqual([]);
      expect(extracted.manifest.toolchainVersion).toBe("1.0.0");
      expect(await Bun.file(join(outDir, "lib/a.ts")).exists()).toBe(false);
      expect(await Bun.file(join(outDir, "manifest.json")).exists()).toBe(true);
    });
  });

  test("readSyncSnapshotArchiveMetadata reads JSON members without extract", async () => {
    const manifest: ToolchainManifest = {
      toolchainVersion: "1.2.3",
      desktopVersion: null,
      gitHead: "abc123",
      lastSyncedAt: "2026-06-23T12:00:00.000Z",
      files: ["lib/utils.ts"],
      fileHashes: { "lib/utils.ts": "deadbeef" },
    };
    const bytes = await createSyncSnapshotArchive(manifest, {
      "lib/utils.ts": "export const x = 1;\n",
    });
    const snapshot = await readSyncSnapshotArchiveMetadata(bytes);
    expect(snapshot.manifest).toEqual(manifest);
    expect(snapshot.files).toEqual(["lib/utils.ts"]);
    expect(snapshot.fileHashes["lib/utils.ts"]).toBe("deadbeef");
    expect(SYNC_SNAPSHOT_META_FILES).toEqual(["manifest.json", "meta.json", "files.json"]);
  });

  test("createSyncSnapshotArchive round-trips manifest and file hashes", async () => {
    const manifest: ToolchainManifest = {
      toolchainVersion: "1.2.3",
      desktopVersion: "1.2.3",
      gitHead: "abc123",
      lastSyncedAt: "2026-06-23T12:00:00.000Z",
      files: ["lib/utils.ts"],
      fileHashes: { "lib/utils.ts": "deadbeef" },
    };

    await withTempDir("archive-snap", async (dir) => {
      const bytes = await createSyncSnapshotArchive(manifest);
      expect(bytes.length).toBeGreaterThan(0);
      expect(hashArchive(bytes)).toMatch(/^[0-9a-f]{8}$/);

      const extracted = await extractSyncSnapshotArchive(bytes, join(dir, "out"));
      expect(extracted.manifest).toEqual(manifest);
      expect(extracted.meta.toolchainVersion).toBe("1.2.3");
      expect(extracted.fileHashes["lib/utils.ts"]).toBe("deadbeef");
    });
  });

  test("createDistArchive bundles directory files", async () => {
    await withTempDir("archive-dist", async (dir) => {
      await Bun.write(join(dir, "alpha.txt"), "alpha");
      await Bun.write(join(dir, "nested/beta.txt"), "beta");

      const { bytes, hash, fileCount } = await createDistArchive(dir);
      expect(fileCount).toBe(2);
      expect(bytes.length).toBeGreaterThan(0);
      expect(hash).toMatch(/^[0-9a-f]{8}$/);

      const hashes = await buildDistFileHashMap(dir);
      expect(Object.keys(hashes).sort()).toEqual(["alpha.txt", "nested/beta.txt"]);
    });
  });

  test("diffDistArchives reports added, removed, and modified entries", async () => {
    await withTempDir("archive-diff", async (dir) => {
      const prevDir = join(dir, "prev");
      const currDir = join(dir, "curr");
      await Bun.write(join(prevDir, "keep.txt"), "same");
      await Bun.write(join(prevDir, "gone.txt"), "old");
      await Bun.write(join(currDir, "keep.txt"), "same");
      await Bun.write(join(currDir, "new.txt"), "fresh");
      await Bun.write(join(currDir, "changed.txt"), "version-two-longer");

      const prev = await createDistArchive(prevDir);
      const curr = await createDistArchive(currDir, { compress: "gzip", level: 6 });

      await Bun.write(join(dir, "prev2", "changed.txt"), "short");
      const prev2 = await createDistArchive(join(dir, "prev2"));

      const diff = await diffDistArchives(prev.bytes, curr.bytes);
      expect(diff.added).toContain("new.txt");
      expect(diff.removed).toContain("gone.txt");

      const modifiedDiff = await diffDistArchives(prev2.bytes, curr.bytes);
      expect(modifiedDiff.modified).toContain("changed.txt");
    });
  });

  test("sync → archive → restore → verify round-trip", async () => {
    await withTempDir("archive-roundtrip", async (dir) => {
      // Create sample repo with files
      const repoDir = join(dir, "repo");
      const cacheDir = join(dir, "cache");
      await Bun.write(join(repoDir, "lib/utils.ts"), "export const x = 1;\n");
      await Bun.write(join(repoDir, "lib/helpers.ts"), "export const y = 2;\n");
      await Bun.write(join(repoDir, "bin/cli.ts"), '#!/usr/bin/env bun\nconsole.log("hi");\n');

      // Build manifest and file contents manually (bypasses sync-path filtering)
      const manifest: ToolchainManifest = {
        toolchainVersion: "1.2.3",
        desktopVersion: "1.2.3",
        gitHead: "abc123",
        lastSyncedAt: new Date().toISOString(),
        files: ["lib/utils.ts", "lib/helpers.ts", "bin/cli.ts"],
        fileHashes: {
          "lib/utils.ts": "aaa111",
          "lib/helpers.ts": "bbb222",
          "bin/cli.ts": "ccc333",
        },
      };

      const fileContents: Record<string, Uint8Array> = {
        "lib/utils.ts": new TextEncoder().encode("export const x = 1;\n"),
        "lib/helpers.ts": new TextEncoder().encode("export const y = 2;\n"),
        "bin/cli.ts": new TextEncoder().encode('#!/usr/bin/env bun\nconsole.log("hi");\n'),
      };

      // Create archive with file contents
      const bytes = await createSyncSnapshotArchive(manifest, fileContents);
      const archiveHash = hashArchive(bytes);
      expect(archiveHash).toMatch(/^[0-9a-f]{8}$/);
      expect(bytes.length).toBeGreaterThan(0);

      // Write archive to disk
      const archivePath = join(cacheDir, "sync-baseline.tar.gz");
      await Bun.write(archivePath, bytes);

      // Extract the archive to a target directory
      const targetDir = join(dir, "restored");
      const archiveBytes = await Bun.file(archivePath).bytes();
      const {
        manifest: restoredManifest,
        meta,
        fileHashes,
      } = await extractSyncSnapshotArchive(archiveBytes, targetDir);

      expect(restoredManifest.toolchainVersion).toBe("1.2.3");
      expect(restoredManifest.gitHead).toBe("abc123");
      expect(restoredManifest.files.sort()).toEqual(manifest.files.sort());
      expect(meta.fileCount).toBe(3);
      expect(fileHashes["lib/utils.ts"]).toBe("aaa111");

      // Verify extracted files exist with correct content
      expect(await Bun.file(join(targetDir, "lib/utils.ts")).text()).toBe("export const x = 1;\n");
      expect(await Bun.file(join(targetDir, "lib/helpers.ts")).text()).toBe(
        "export const y = 2;\n"
      );
      expect(await Bun.file(join(targetDir, "bin/cli.ts")).text()).toBe(
        '#!/usr/bin/env bun\nconsole.log("hi");\n'
      );

      // Verify dist integrity: extracted == current
      const current = await createDistArchive(targetDir);
      const diff = await diffDistArchives(archiveBytes, current.bytes);

      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
    });
  });
});
