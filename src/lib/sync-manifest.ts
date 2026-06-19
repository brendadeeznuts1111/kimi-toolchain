/**
 * Sync manifest generation and verification.
 *
 * The manifest is generated from the same sync-managed source set used by
 * desktop drift detection. This keeps pre-push from trusting stale hashes.
 */

import { computeSyncHashes, detectSyncDrift, type SyncDriftReport } from "./sync-hashes.ts";
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

export async function verifySyncManifest(repoRoot: string): Promise<SyncManifestVerification> {
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
