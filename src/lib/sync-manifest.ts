/**
 * Sync manifest generation and verification.
 *
 * The manifest is generated from the same sync-managed source set used by
 * desktop drift detection. This keeps pre-push from trusting stale hashes.
 */

import { writeSyncSnapshotArchive } from "./archive-persistence.ts";
import { pathExists } from "./bun-io.ts";
import { computeSyncHashes, detectSyncDrift, type SyncDriftReport } from "./sync-hashes.ts";
import { canonicalRepoRoot } from "./paths.ts";
import { resolveSyncManagedSourcePath } from "./sync-paths.ts";

export { resolveSyncManagedSourcePath } from "./sync-paths.ts";
import {
  TOOLCHAIN_VERSION,
  getDesktopVersion,
  getRepoHead,
  readManifest,
  writeManifest,
  type ToolchainManifest,
} from "./version.ts";

export interface WriteSyncManifestOptions {
  files?: string[];
}

export interface SyncManifestVerification {
  ok: boolean;
  manifestPresent: boolean;
  manifestFresh: boolean;
  desktopSynced: boolean;
  missingHashes: string[];
  changedHashes: string[];
  extraHashes: string[];
  drift: SyncDriftReport;
}

export async function buildSyncManifest(
  repoRoot: string,
  options: WriteSyncManifestOptions = {}
): Promise<ToolchainManifest> {
  repoRoot = canonicalRepoRoot(repoRoot);
  const [desktopVersion, gitHead, fileHashes] = await Promise.all([
    getDesktopVersion(),
    getRepoHead(),
    computeSyncHashes(repoRoot),
  ]);
  return {
    toolchainVersion: TOOLCHAIN_VERSION,
    desktopVersion,
    gitHead,
    lastSyncedAt: new Date().toISOString(),
    files: options.files ?? [],
    fileHashes,
  };
}

export async function writeSyncManifest(
  repoRoot: string,
  options: WriteSyncManifestOptions = {}
): Promise<ToolchainManifest> {
  const manifest = await buildSyncManifest(repoRoot, options);
  await writeManifest(manifest);
  return manifest;
}

async function collectSyncArchiveContents(
  repoRoot: string,
  manifest: ToolchainManifest
): Promise<Record<string, Uint8Array>> {
  const contents: Record<string, Uint8Array> = {};
  for (const key of Object.keys(manifest.fileHashes ?? {})) {
    const sourcePath = resolveSyncManagedSourcePath(repoRoot, key);
    if (!sourcePath || !pathExists(sourcePath)) continue;
    contents[key] = await Bun.file(sourcePath).bytes();
  }
  return contents;
}

/** Write gzip baseline tarball for an existing manifest (manifest JSON already on disk). */
export async function writeSyncArchiveBaseline(
  repoRoot: string,
  archivePath: string,
  manifest: ToolchainManifest
): Promise<{ archiveHash: string; byteLength: number }> {
  const archived = await writeSyncSnapshotArchive(
    manifest,
    archivePath,
    await collectSyncArchiveContents(repoRoot, manifest)
  );
  return { archiveHash: archived.archiveHash, byteLength: archived.byteLength };
}

/** Write manifest JSON plus a gzip tarball baseline for atomic restore / upload. */
export async function writeSyncManifestWithArchive(
  repoRoot: string,
  archivePath: string,
  options: WriteSyncManifestOptions = {}
): Promise<{
  manifest: ToolchainManifest;
  archiveHash: string;
  byteLength: number;
}> {
  const manifest = await writeSyncManifest(repoRoot, options);
  const archived = await writeSyncArchiveBaseline(repoRoot, archivePath, manifest);
  return { manifest, ...archived };
}

export async function verifySyncManifest(repoRoot: string): Promise<SyncManifestVerification> {
  repoRoot = canonicalRepoRoot(repoRoot);
  const [manifest, expectedHashes, drift] = await Promise.all([
    readManifest(),
    computeSyncHashes(repoRoot),
    detectSyncDrift(repoRoot),
  ]);

  const manifestHashes = manifest?.fileHashes ?? {};
  const missingHashes: string[] = [];
  const changedHashes: string[] = [];
  const extraHashes: string[] = [];

  for (const [key, expected] of Object.entries(expectedHashes)) {
    const actual = manifestHashes[key];
    if (!actual) missingHashes.push(key);
    else if (actual !== expected) changedHashes.push(key);
  }

  for (const key of Object.keys(manifestHashes)) {
    if (!(key in expectedHashes)) extraHashes.push(key);
  }

  const manifestFresh =
    !!manifest &&
    missingHashes.length === 0 &&
    changedHashes.length === 0 &&
    extraHashes.length === 0;
  const desktopSynced = drift.synced;

  return {
    ok: manifestFresh && desktopSynced,
    manifestPresent: !!manifest,
    manifestFresh,
    desktopSynced,
    missingHashes: missingHashes.sort(),
    changedHashes: changedHashes.sort(),
    extraHashes: extraHashes.sort(),
    drift,
  };
}
