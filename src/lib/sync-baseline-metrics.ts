/**
 * Sync baseline tarball metrics for dashboard cards and drift spotting.
 */

import { hashArchive } from "./archive-persistence.ts";
import { makeDir } from "./bun-io.ts";
import { appendNdjsonRecord, readNdjsonFile } from "./ndjson.ts";
import {
  syncBaselineArchivePath,
  syncBaselineCacheArchivePath,
  syncBaselineHistoryPath,
  syncBaselineMetricsPath,
  varDir,
} from "./paths.ts";
import { safeParse } from "./utils.ts";
import { readManifest } from "./version.ts";
import { resolveEffectiveWorkspaceRoot } from "./workspace-health.ts";

export interface SyncBaselineMetrics {
  ok: boolean;
  archivePath: string | null;
  syncBaselineSize: number;
  syncBaselineHash: string | null;
  fileCount: number | null;
  toolchainVersion: string | null;
  lastSyncedAt: string | null;
}

export interface SyncBaselineMetricsSnapshot extends SyncBaselineMetrics {
  recordedAt: string;
  previousSyncBaselineHash: string | null;
  previousSyncBaselineSize: number | null;
  hashChanged: boolean;
  sizeDelta: number;
}

export interface SyncBaselineHistoryEntry {
  t: number;
  syncBaselineSize: number;
  syncBaselineHash: string;
  hashChanged: boolean;
  sizeDelta: number;
  fileCount: number | null;
  driftCount: number;
}

/** Aggregated history for dashboard sparklines. */
export interface SyncBaselineHistory {
  timestamps: string[];
  sizes: number[];
  hashes: string[];
  driftCounts: number[];
}

interface StoredSyncBaselineMetrics {
  recordedAt: string;
  archivePath: string;
  syncBaselineSize: number;
  syncBaselineHash: string;
  fileCount: number | null;
  toolchainVersion: string | null;
  lastSyncedAt: string | null;
  previousSyncBaselineHash: string | null;
  previousSyncBaselineSize: number | null;
}

/** Resolve the newest baseline archive path (cache dir, then desktop var). */
export async function resolveSyncBaselineArchivePath(repoRoot: string): Promise<string | null> {
  const cachePath = syncBaselineCacheArchivePath(repoRoot);
  if (await Bun.file(cachePath).exists()) return cachePath;
  const desktopPath = syncBaselineArchivePath();
  if (await Bun.file(desktopPath).exists()) return desktopPath;
  return null;
}

/** Read tarball size + crc32 hash and manifest summary. */
export async function readSyncBaselineMetrics(repoRoot?: string): Promise<SyncBaselineMetrics> {
  const root = repoRoot ?? resolveEffectiveWorkspaceRoot(Bun.cwd).root;
  const archivePath = await resolveSyncBaselineArchivePath(root);
  if (!archivePath) {
    return {
      ok: false,
      archivePath: null,
      syncBaselineSize: 0,
      syncBaselineHash: null,
      fileCount: null,
      toolchainVersion: null,
      lastSyncedAt: null,
    };
  }

  const bytes = await Bun.file(archivePath).bytes();
  const manifest = await readManifest();

  return {
    ok: true,
    archivePath,
    syncBaselineSize: bytes.byteLength,
    syncBaselineHash: hashArchive(bytes),
    fileCount: manifest ? Object.keys(manifest.fileHashes ?? {}).length : null,
    toolchainVersion: manifest?.toolchainVersion ?? null,
    lastSyncedAt: manifest?.lastSyncedAt ?? null,
  };
}

async function readStoredMetrics(): Promise<StoredSyncBaselineMetrics | null> {
  const path = syncBaselineMetricsPath();
  if (!(await Bun.file(path).exists())) return null;
  return safeParse<StoredSyncBaselineMetrics | null>(await Bun.file(path).text(), null);
}

/** Persist baseline metrics after sync; returns snapshot with previous-run drift fields. */
export async function recordSyncBaselineMetrics(
  repoRoot: string,
  live?: SyncBaselineMetrics
): Promise<SyncBaselineMetricsSnapshot | null> {
  const current = live ?? (await readSyncBaselineMetrics(repoRoot));
  if (!current.ok || !current.archivePath || !current.syncBaselineHash) return null;

  const previous = await readStoredMetrics();
  const snapshot: SyncBaselineMetricsSnapshot = {
    ...current,
    recordedAt: new Date().toISOString(),
    previousSyncBaselineHash: previous?.syncBaselineHash ?? null,
    previousSyncBaselineSize: previous?.syncBaselineSize ?? null,
    hashChanged:
      previous?.syncBaselineHash != null && previous.syncBaselineHash !== current.syncBaselineHash,
    sizeDelta: previous ? current.syncBaselineSize - previous.syncBaselineSize : 0,
  };

  makeDir(varDir(), { recursive: true });
  const stored: StoredSyncBaselineMetrics = {
    recordedAt: snapshot.recordedAt,
    archivePath: current.archivePath,
    syncBaselineSize: current.syncBaselineSize,
    syncBaselineHash: current.syncBaselineHash,
    fileCount: current.fileCount,
    toolchainVersion: current.toolchainVersion,
    lastSyncedAt: current.lastSyncedAt,
    previousSyncBaselineHash: snapshot.previousSyncBaselineHash,
    previousSyncBaselineSize: snapshot.previousSyncBaselineSize,
  };
  await Bun.write(syncBaselineMetricsPath(), JSON.stringify(stored, null, 2));
  await appendBaselineHistory(repoRoot, snapshot);
  return snapshot;
}

/** Append one baseline metrics row to repo JSONL history. */
export async function appendBaselineHistory(
  repoRoot: string,
  metrics: SyncBaselineMetricsSnapshot
): Promise<void> {
  if (!metrics.syncBaselineHash) return;
  const entry: SyncBaselineHistoryEntry = {
    t: Date.now(),
    syncBaselineSize: metrics.syncBaselineSize,
    syncBaselineHash: metrics.syncBaselineHash,
    hashChanged: metrics.hashChanged,
    sizeDelta: metrics.sizeDelta,
    fileCount: metrics.fileCount,
    driftCount: metrics.hashChanged ? 1 : 0,
  };
  await appendNdjsonRecord(syncBaselineHistoryPath(repoRoot), entry);
}

/** Read baseline history (last N entries) for sparkline rendering. */
export async function readSyncBaselineHistory(
  repoRoot: string,
  limit = 32
): Promise<SyncBaselineHistory> {
  const records = await readNdjsonFile<SyncBaselineHistoryEntry>(syncBaselineHistoryPath(repoRoot));
  const slice = records.slice(-limit);
  return {
    timestamps: slice.map((row) => new Date(row.t).toISOString()),
    sizes: slice.map((row) => row.syncBaselineSize),
    hashes: slice.map((row) => row.syncBaselineHash),
    driftCounts: slice.map((row) => row.driftCount),
  };
}

export interface SyncBaselineMetricsView extends SyncBaselineMetricsSnapshot {
  history: SyncBaselineHistory;
}

/** Dashboard/API view: live metrics merged with last recorded drift snapshot. */
export async function readSyncBaselineMetricsWithDrift(
  repoRoot?: string
): Promise<SyncBaselineMetricsView> {
  const root = repoRoot ?? resolveEffectiveWorkspaceRoot(Bun.cwd).root;
  const live = await readSyncBaselineMetrics(root);
  const stored = await readStoredMetrics();
  const history = await readSyncBaselineHistory(root);

  if (!live.ok) {
    return {
      ...live,
      recordedAt: stored?.recordedAt ?? new Date().toISOString(),
      previousSyncBaselineHash: stored?.previousSyncBaselineHash ?? null,
      previousSyncBaselineSize: stored?.previousSyncBaselineSize ?? null,
      hashChanged: false,
      sizeDelta: 0,
      history,
    };
  }

  const hashChanged =
    stored?.syncBaselineHash != null && stored.syncBaselineHash !== live.syncBaselineHash;
  const sizeDelta = stored ? live.syncBaselineSize - stored.syncBaselineSize : 0;

  return {
    ...live,
    recordedAt: stored?.recordedAt ?? new Date().toISOString(),
    previousSyncBaselineHash: stored?.syncBaselineHash ?? null,
    previousSyncBaselineSize: stored?.syncBaselineSize ?? null,
    hashChanged,
    sizeDelta,
    history,
  };
}
