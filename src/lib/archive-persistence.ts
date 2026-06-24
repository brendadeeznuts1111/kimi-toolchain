/**
 * Bun.Archive integration — snapshot bundling, dist archiving, and drift diffing.
 *
 * Replaces manual JSON + per-file integrity scans with a single gzip tarball artifact.
 *
 * @see https://bun.com/docs/runtime/archive
 * @see {@link BUN_ARCHIVE_RELEASE_URL}
 */

import { BUN_ARCHIVE_RELEASE_URL } from "./bun-utils.ts";
import { dirname, join } from "path";

/** @see {@link BUN_ARCHIVE_RELEASE_URL} */
export { BUN_ARCHIVE_RELEASE_URL };
import { makeDir, parseJsonValue, readJsonFile } from "./bun-io.ts";
import { scanTreeSync } from "./globs.ts";
import { isToolchainManifest, type ToolchainManifest } from "./version.ts";

/** @see https://bun.com/docs/runtime/archive */
export const BUN_ARCHIVE_DOC_URL = "https://bun.com/docs/runtime/archive";

export type ArchiveCompressOptions = {
  /** @see https://bun.com/docs/runtime/archive — `{ compress: "gzip" }` default level 6 */
  compress?: "gzip";
  /** Gzip level 1–12 when compress is enabled (1 = fastest, 12 = smallest). */
  level?: number;
};

/** JSON members bundled in every sync snapshot archive. */
export const SYNC_SNAPSHOT_META_FILES = ["manifest.json", "meta.json", "files.json"] as const;

function normalizeArchiveOpts(opts: ArchiveCompressOptions): ArchiveCompressOptions {
  if (!opts.compress) return opts;
  const level = opts.level ?? 6;
  return { compress: "gzip", level: Math.min(12, Math.max(1, level)) };
}

export interface SnapshotArchiveMeta {
  createdAt: string;
  toolchainVersion: string;
  gitHead: string | null;
  bunVersion: string;
  fileCount: number;
}

function recordField(obj: unknown, key: string): unknown {
  return typeof obj === "object" && obj !== null
    ? (obj as Record<string, unknown>)[key]
    : undefined;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

function isSnapshotArchiveMeta(value: unknown): value is SnapshotArchiveMeta {
  const gitHead = recordField(value, "gitHead");
  return (
    typeof value === "object" &&
    value !== null &&
    typeof recordField(value, "createdAt") === "string" &&
    typeof recordField(value, "toolchainVersion") === "string" &&
    (gitHead === null || typeof gitHead === "string") &&
    typeof recordField(value, "bunVersion") === "string" &&
    typeof recordField(value, "fileCount") === "number"
  );
}

export interface SyncSnapshotArchive {
  manifest: ToolchainManifest;
  meta: SnapshotArchiveMeta;
  fileHashes: Record<string, string>;
  files: string[];
}

export interface DistArchiveResult {
  bytes: Uint8Array;
  hash: string;
  fileCount: number;
}

export interface ArchiveDiffResult {
  added: string[];
  removed: string[];
  modified: string[];
}

const DEFAULT_SNAPSHOT_OPTS = {
  compress: "gzip",
  level: 9,
} as const satisfies ArchiveCompressOptions;
const DEFAULT_DIST_OPTS = { compress: "gzip", level: 6 } as const satisfies ArchiveCompressOptions;
const _SNAPSHOT_META_FILES = new Set<string>(SYNC_SNAPSHOT_META_FILES);

/** Probe whether Bun.Archive is available on the current runtime. */
export function archiveSupported(): boolean {
  return typeof (Bun as typeof Bun & { Archive?: unknown }).Archive === "function";
}

/** CRC32 hex digest for archive bytes (unsigned, zero-padded). */
export function hashArchive(archiveBytes: Uint8Array | ArrayBuffer): string {
  return (Bun.hash.crc32(archiveBytes) >>> 0).toString(16).padStart(8, "0");
}

/** CRC32 hex for a file on disk — fast dist drift fingerprint. */
export async function hashFileCrc32(filePath: string): Promise<string> {
  const bytes = await Bun.file(filePath).arrayBuffer();
  return hashArchive(bytes);
}

function requireArchive(): typeof Bun.Archive {
  if (!archiveSupported()) {
    throw new Error("Bun.Archive is unavailable on this runtime");
  }
  return Bun.Archive;
}

function buildArchiveMeta(
  manifest: ToolchainManifest,
  fileHashes: Record<string, string>
): SnapshotArchiveMeta {
  return {
    createdAt: manifest.lastSyncedAt,
    toolchainVersion: manifest.toolchainVersion,
    gitHead: manifest.gitHead,
    bunVersion: Bun.version,
    fileCount: Object.keys(fileHashes).length,
  };
}

function assertSafeArchivePath(path: string): void {
  if (
    path.startsWith("/") ||
    path.includes("..") ||
    path === "manifest.json" ||
    path === "meta.json" ||
    path === "files.json"
  ) {
    throw new Error(`Unsafe archive path: ${path}`);
  }
}

/** Bundle a sync manifest + file hash map into a gzip tarball. */
export async function createSyncSnapshotArchive(
  manifest: ToolchainManifest,
  fileContentsOrOpts: Record<string, Uint8Array | string> | ArchiveCompressOptions = {},
  opts: ArchiveCompressOptions = DEFAULT_SNAPSHOT_OPTS
): Promise<Uint8Array> {
  const Archive = requireArchive();
  const fileContents =
    "compress" in fileContentsOrOpts || "level" in fileContentsOrOpts ? {} : fileContentsOrOpts;
  const archiveOpts =
    "compress" in fileContentsOrOpts || "level" in fileContentsOrOpts ? fileContentsOrOpts : opts;
  const fileHashes = manifest.fileHashes ?? {};
  const meta = buildArchiveMeta(manifest, fileHashes);
  const entries: Record<string, Uint8Array | string> = {
    "manifest.json": JSON.stringify(manifest),
    "meta.json": JSON.stringify(meta),
    "files.json": JSON.stringify(fileHashes),
  };

  for (const [path, content] of Object.entries(fileContents)) {
    assertSafeArchivePath(path);
    entries[path] = content;
  }

  const archive = new Archive(entries, normalizeArchiveOpts(archiveOpts));

  return archive.bytes();
}

export interface ExtractSyncSnapshotOptions {
  /** Glob filter passed to Bun.Archive.extract (default: extract all entries). */
  glob?: string | readonly string[];
}

/**
 * Read sync snapshot metadata via glob-filtered `archive.files()` — no payload load.
 * @see https://bun.com/docs/runtime/archive — "Filtering with Glob Patterns"
 */
export async function readSyncSnapshotArchiveMetadata(
  archiveBytes: Uint8Array | Blob
): Promise<SyncSnapshotArchive> {
  const Archive = requireArchive();
  const archive = new Archive(archiveBytes);
  const metaFiles = await archive.files([...SYNC_SNAPSHOT_META_FILES]);

  async function readJsonMember<T>(name: string): Promise<T> {
    const file = metaFiles.get(name);
    if (!file) throw new Error(`${name} missing from archive`);
    return JSON.parse(await file.text()) as T;
  }

  const manifest = await readJsonMember<ToolchainManifest>("manifest.json");
  const meta = await readJsonMember<SnapshotArchiveMeta>("meta.json");
  const fileHashes = await readJsonMember<Record<string, string>>("files.json");
  const files = Object.keys(fileHashes).sort();

  return { manifest, meta, fileHashes, files };
}

/** Extract a sync snapshot archive and parse bundled JSON members. */
export async function extractSyncSnapshotArchive(
  archiveBytes: Uint8Array | Blob,
  outDir: string,
  options: ExtractSyncSnapshotOptions = {}
): Promise<SyncSnapshotArchive> {
  const Archive = requireArchive();
  makeDir(outDir, { recursive: true });

  const archive = new Archive(archiveBytes);
  const archiveFiles = options.glob ? await archive.files(options.glob) : await archive.files();
  await archive.extract(outDir, options.glob ? { glob: options.glob } : undefined);

  const manifest = parseJsonValue(
    await readJsonFile(join(outDir, "manifest.json")),
    isToolchainManifest,
    "manifest.json"
  );
  const meta = parseJsonValue(
    await readJsonFile(join(outDir, "meta.json")),
    isSnapshotArchiveMeta,
    "meta.json"
  );
  const fileHashes = parseJsonValue(
    await readJsonFile(join(outDir, "files.json")),
    isStringRecord,
    "files.json"
  );
  const files = [...archiveFiles.keys()]
    .filter((file) => file !== "manifest.json" && file !== "meta.json" && file !== "files.json")
    .sort();

  return { manifest, meta, fileHashes, files };
}

/** Scan a directory tree into a gzip tarball with per-entry CRC32 hashes. */
export async function createDistArchive(
  distDir: string,
  opts: ArchiveCompressOptions = DEFAULT_DIST_OPTS
): Promise<DistArchiveResult> {
  const Archive = requireArchive();
  const files: Record<string, Uint8Array> = {};

  for (const entry of scanTreeSync(distDir)) {
    const normalized = entry.replace(/\\/g, "/");
    const file = Bun.file(join(distDir, entry));
    if (await file.exists()) {
      files[normalized] = await file.bytes();
    }
  }

  const archive = new Archive(files, normalizeArchiveOpts(opts));
  const bytes = await archive.bytes();

  return {
    bytes,
    hash: hashArchive(bytes),
    fileCount: Object.keys(files).length,
  };
}

/** Build a path → CRC32 map for a directory without creating an archive. */
export async function buildDistFileHashMap(distDir: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};

  for (const entry of scanTreeSync(distDir)) {
    const path = join(distDir, entry);
    const file = Bun.file(path);
    if (await file.exists()) {
      hashes[entry] = await hashFileCrc32(path);
    }
  }

  return hashes;
}

/** Compare two dist archives by entry path, size, and lastModified. */
export async function diffDistArchives(
  previousArchive: Uint8Array | Blob,
  currentArchive: Uint8Array | Blob
): Promise<ArchiveDiffResult> {
  const Archive = requireArchive();
  const prev = new Archive(previousArchive);
  const curr = new Archive(currentArchive);

  const prevFiles = await prev.files();
  const currFiles = await curr.files();

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const [name, file] of currFiles) {
    if (!prevFiles.has(name)) {
      added.push(name);
      continue;
    }
    const prevFile = prevFiles.get(name)!;
    if (prevFile.size !== file.size || prevFile.lastModified !== file.lastModified) {
      modified.push(name);
    }
  }

  for (const [name] of prevFiles) {
    if (!currFiles.has(name)) removed.push(name);
  }

  added.sort();
  removed.sort();
  modified.sort();

  return { added, removed, modified };
}

/** Write a gzipped sync snapshot archive to disk; returns manifest + archive hash. */
export async function writeSyncSnapshotArchive(
  manifest: ToolchainManifest,
  archivePath: string,
  fileContents: Record<string, Uint8Array | string> = {},
  opts: ArchiveCompressOptions = DEFAULT_SNAPSHOT_OPTS
): Promise<{ manifest: ToolchainManifest; archiveHash: string; byteLength: number }> {
  const bytes = await createSyncSnapshotArchive(manifest, fileContents, opts);
  makeDir(dirname(archivePath), { recursive: true });
  await Bun.write(archivePath, bytes);
  return {
    manifest,
    archiveHash: hashArchive(bytes),
    byteLength: bytes.length,
  };
}
