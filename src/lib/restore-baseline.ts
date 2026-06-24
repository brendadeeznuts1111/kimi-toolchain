/**
 * Restore sync manifest baseline from a Bun.Archive gzip tarball.
 */

import { join } from "path";
import { tmpdir } from "os";
import {
  archiveSupported,
  extractSyncSnapshotArchive,
  readSyncSnapshotArchiveMetadata,
} from "./archive-persistence.ts";
import { STATUS_COLORS } from "./color-matrix.ts";
import { makeDir, removePath } from "./bun-io.ts";
import { syncBaselineArchivePath } from "./paths.ts";
import { resolveSyncManagedSourcePath } from "./sync-manifest.ts";
import { computeSyncHashes } from "./sync-hashes.ts";
import { sha256File } from "./utils.ts";
import { writeManifest, type ToolchainManifest } from "./version.ts";

export interface HashDiffResult {
  missing: string[];
  changed: string[];
  extra: string[];
}

export interface VerifyManifestHashesResult {
  ok: boolean;
  drift: string[];
}

export interface RestoreBaselineOptions {
  archivePath?: string;
  repoRoot: string;
  verify?: boolean;
  dryRun?: boolean;
}

export interface RestoreBaselineResult {
  manifest: ToolchainManifest;
  meta: { bunVersion: string; fileCount: number; createdAt: string };
  hashDiff?: HashDiffResult;
  driftRows?: RestoreDriftRow[];
  wroteManifest: boolean;
}

export interface RestoreBaselineToDirOptions {
  verify?: boolean;
  dryRun?: boolean;
}

export interface RestoreBaselineToDirResult {
  archivePath: string;
  targetDir: string;
  dryRun: boolean;
  verified: boolean;
  manifest: ToolchainManifest;
  restoredFiles: string[];
  restored: number;
  drift: string[];
}

/** Compare archived sha256 file hashes against a live hash map. */
export function diffArchivedHashes(
  archived: Record<string, string>,
  current: Record<string, string>
): HashDiffResult {
  const missing: string[] = [];
  const changed: string[] = [];
  const extra: string[] = [];

  for (const [key, expected] of Object.entries(archived)) {
    const actual = current[key];
    if (!actual) missing.push(key);
    else if (actual !== expected) changed.push(key);
  }

  for (const key of Object.keys(current)) {
    if (!(key in archived)) extra.push(key);
  }

  return {
    missing: missing.sort(),
    changed: changed.sort(),
    extra: extra.sort(),
  };
}

/** Verify extracted files match manifest sha256 hashes. */
export async function verifyManifestHashes(
  manifest: ToolchainManifest,
  targetDir: string
): Promise<VerifyManifestHashesResult> {
  const fileHashes = manifest.fileHashes ?? {};
  const drift: string[] = [];

  for (const [file, expectedHash] of Object.entries(fileHashes)) {
    const path = join(targetDir, file);
    if (!(await Bun.file(path).exists())) {
      drift.push(`missing ${file}`);
      continue;
    }
    const actualHash = await sha256File(path);
    if (actualHash !== expectedHash) drift.push(`changed ${file}`);
  }

  drift.sort();
  return { ok: drift.length === 0, drift };
}

function hashDiffFailed(diff: HashDiffResult): boolean {
  return diff.missing.length > 0 || diff.changed.length > 0 || diff.extra.length > 0;
}

async function syncManagedByteSize(repoRoot: string, syncKey: string): Promise<number | undefined> {
  const sourcePath = resolveSyncManagedSourcePath(repoRoot, syncKey);
  if (!sourcePath) return undefined;
  const file = Bun.file(sourcePath);
  if (!(await file.exists())) return undefined;
  return file.size;
}

function hashPreview(hash: string | undefined): string {
  return hash ? hash.slice(0, 8) : "—";
}

export type RestoreDryRunStatus = "add" | "remove" | "modify";

/** Drift row for dry-run table output. */
export interface RestoreDriftRow {
  file: string;
  status: RestoreDryRunStatus;
  oldHash?: string;
  newHash?: string;
  bytes?: number;
}

/** @deprecated Use RestoreDriftRow */
export type RestoreDryRunRow = RestoreDriftRow;

/** Build enriched drift rows with sha256 previews and file sizes. */
export async function computeHashDiffDriftRows(
  archived: Record<string, string>,
  current: Record<string, string>,
  repoRoot: string
): Promise<RestoreDriftRow[]> {
  const diff = diffArchivedHashes(archived, current);
  const rows: RestoreDriftRow[] = [];

  for (const file of diff.extra) {
    rows.push({
      file,
      status: "add",
      newHash: current[file],
      bytes: await syncManagedByteSize(repoRoot, file),
    });
  }
  for (const file of diff.missing) {
    rows.push({ file, status: "remove", oldHash: archived[file] });
  }
  for (const file of diff.changed) {
    rows.push({
      file,
      status: "modify",
      oldHash: archived[file],
      newHash: current[file],
      bytes: await syncManagedByteSize(repoRoot, file),
    });
  }

  rows.sort((a, b) => a.file.localeCompare(b.file) || a.status.localeCompare(b.status));
  return rows;
}

/** In-memory dry-run: read JSON via `archive.files()` and diff against repo hashes. */
export async function dryRunRestoreBaseline(
  archivePath: string,
  repoRoot: string
): Promise<{ driftRows: RestoreDriftRow[]; hashDiff: HashDiffResult; ok: boolean }> {
  if (!archiveSupported()) {
    throw new Error("Bun.Archive is unavailable on this runtime");
  }
  const archiveFile = Bun.file(archivePath);
  if (!(await archiveFile.exists())) {
    throw new Error(`Archive not found: ${archivePath}`);
  }

  const { fileHashes } = await readSyncSnapshotArchiveMetadata(await archiveFile.bytes());
  const current = await computeSyncHashes(repoRoot);
  const hashDiff = diffArchivedHashes(fileHashes, current);
  const driftRows = await computeHashDiffDriftRows(fileHashes, current, repoRoot);
  return { driftRows, hashDiff, ok: !hashDiffFailed(hashDiff) };
}

/** Map archive-vs-repo hash diff to dry-run table rows (no hash/size enrichment). */
export function hashDiffTableRows(diff: HashDiffResult): RestoreDriftRow[] {
  const rows: RestoreDriftRow[] = [
    ...diff.extra.map((file) => ({ file, status: "add" as const })),
    ...diff.missing.map((file) => ({ file, status: "remove" as const })),
    ...diff.changed.map((file) => ({ file, status: "modify" as const })),
  ];
  rows.sort((a, b) => a.file.localeCompare(b.file) || a.status.localeCompare(b.status));
  return rows;
}

/** Map post-extract drift strings (`missing foo`, `changed bar`) to table rows. */
export function driftTableRows(drift: string[]): RestoreDriftRow[] {
  const rows: RestoreDriftRow[] = [];
  for (const line of drift) {
    if (line.startsWith("missing ")) {
      rows.push({ file: line.slice("missing ".length), status: "remove" });
      continue;
    }
    if (line.startsWith("changed ")) {
      rows.push({ file: line.slice("changed ".length), status: "modify" });
    }
  }
  rows.sort((a, b) => a.file.localeCompare(b.file));
  return rows;
}

/** Tabular dry-run preview — `Bun.inspect.table` with domain status colors. */
export function printRestoreDryRunTable(drift: RestoreDriftRow[]): void {
  if (drift.length === 0) {
    console.error("[restore] dry-run: no drift detected");
    return;
  }

  const rows = drift.map((d) => ({
    file: d.file,
    status: d.status,
    "sha256 (old → new)":
      d.oldHash || d.newHash ? `${hashPreview(d.oldHash)} → ${hashPreview(d.newHash)}` : "—",
    bytes: d.bytes ?? "—",
  }));

  const table = Bun.inspect.table(rows, ["file", "status", "sha256 (old → new)", "bytes"], {
    colors: true,
  });

  const colored = table
    .replace(/\b(add)\b/g, `\x1b[38;2;${STATUS_COLORS.add}m$1\x1b[0m`)
    .replace(/\b(remove)\b/g, `\x1b[38;2;${STATUS_COLORS.remove}m$1\x1b[0m`)
    .replace(/\b(modify)\b/g, `\x1b[38;2;${STATUS_COLORS.modify}m$1\x1b[0m`);

  console.error(`[restore] dry-run drift (${drift.length} row(s)):`);
  console.error(colored);
}

export const BASELINE_DRIFT_MESSAGE =
  "Baseline drift detected. Run `bun run sync` to refresh, or commit changes.";

/** Extract archive, optionally verify hashes, and restore manifest to ~/.kimi-code/. */
export async function restoreSyncBaseline(
  options: RestoreBaselineOptions
): Promise<RestoreBaselineResult> {
  if (!archiveSupported()) {
    throw new Error("Bun.Archive is unavailable on this runtime");
  }

  const archivePath = options.archivePath ?? syncBaselineArchivePath();
  const archiveFile = Bun.file(archivePath);
  if (!(await archiveFile.exists())) {
    throw new Error(`Archive not found: ${archivePath}`);
  }

  const { manifest, meta, fileHashes } = await readSyncSnapshotArchiveMetadata(
    await archiveFile.bytes()
  );

  let hashDiff: HashDiffResult | undefined;
  let driftRows: RestoreDriftRow[] | undefined;
  if (options.verify !== false) {
    const current = await computeSyncHashes(options.repoRoot);
    hashDiff = diffArchivedHashes(fileHashes, current);
    driftRows = await computeHashDiffDriftRows(fileHashes, current, options.repoRoot);
    if (hashDiffFailed(hashDiff)) {
      const err = new Error(
        `${BASELINE_DRIFT_MESSAGE} (+${hashDiff.missing.length}/-${hashDiff.extra.length}/~${hashDiff.changed.length})`
      ) as Error & { hashDiff: HashDiffResult; driftRows: RestoreDriftRow[] };
      err.hashDiff = hashDiff;
      err.driftRows = driftRows;
      throw err;
    }
  }

  const wroteManifest = !options.dryRun;
  if (wroteManifest) {
    await writeManifest(manifest);
  }

  return {
    manifest,
    meta: {
      bunVersion: meta.bunVersion,
      fileCount: meta.fileCount,
      createdAt: meta.createdAt,
    },
    hashDiff,
    driftRows,
    wroteManifest,
  };
}

/** Extract archive payloads to a target directory (or temp when dry-run). */
export async function restoreBaselineToDir(
  archivePath: string,
  targetDir: string,
  options: RestoreBaselineToDirOptions = {}
): Promise<RestoreBaselineToDirResult> {
  if (!archiveSupported()) {
    throw new Error("Bun.Archive is unavailable on this runtime");
  }

  const archiveFile = Bun.file(archivePath);
  if (!(await archiveFile.exists())) {
    throw new Error(`archive not found: ${archivePath}`);
  }

  const verify = options.verify !== false;
  const dryRun = options.dryRun === true;
  const extractDir = dryRun
    ? join(tmpdir(), `kimi-restore-baseline-${Bun.randomUUIDv7()}`)
    : targetDir;
  makeDir(extractDir, { recursive: true });

  try {
    const snapshot = await extractSyncSnapshotArchive(await archiveFile.bytes(), extractDir);

    let drift: string[] = [];
    if (verify) {
      const check = await verifyManifestHashes(snapshot.manifest, extractDir);
      drift = check.drift;
      if (!check.ok) {
        const err = new Error("hash mismatch post-extract") as Error & {
          drift: string[];
          driftRows: RestoreDriftRow[];
        };
        err.drift = drift;
        err.driftRows = driftTableRows(drift);
        throw err;
      }
    }

    return {
      archivePath,
      targetDir,
      dryRun,
      verified: verify,
      manifest: snapshot.manifest,
      restoredFiles: snapshot.files,
      restored: snapshot.files.length,
      drift,
    };
  } finally {
    if (dryRun) {
      removePath(extractDir, { recursive: true, force: true });
    }
  }
}
