/**
 * Sync harness — manifest write + baseline archive (3-state gate; default auto).
 */

import { archiveSupported } from "../lib/archive-persistence.ts";
import { syncBaselineCacheArchivePath } from "../lib/paths.ts";
import { recordSyncBaselineMetrics } from "../lib/sync-baseline-metrics.ts";
import { writeSyncArchiveBaseline, writeSyncManifest } from "../lib/sync-manifest.ts";
import { getRepoHead, readManifest } from "../lib/version.ts";
import type { ToolchainManifest } from "../lib/version.ts";

export { syncBaselineCacheArchivePath };

export type ArchiveMode = "always" | "never" | "auto";

const ARCHIVE_MODE_ALIASES: Record<string, ArchiveMode> = {
  always: "always",
  never: "never",
  auto: "auto",
  "1": "always",
  "0": "never",
  true: "always",
  false: "never",
};

export interface FinalizeSyncArchiveOptions {
  files: string[];
  /** Baseline tarball; omit to resolve via shouldWriteArchive(). */
  writeArchive?: boolean;
  archivePath?: string;
}

/** Parse archive mode from CLI flags and KIMI_SYNC_ARCHIVE. */
export function resolveArchiveMode(
  argv: string[] = Bun.argv,
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>
): ArchiveMode {
  if (argv.includes("--no-archive")) return "never";

  const flag = argv.find((arg) => arg.startsWith("--archive="));
  if (flag) {
    const mode = flag.slice("--archive=".length);
    if (mode === "always" || mode === "never" || mode === "auto") return mode;
  }

  const raw = env.KIMI_SYNC_ARCHIVE;
  if (raw != null && raw !== "") {
    const mapped = ARCHIVE_MODE_ALIASES[raw.toLowerCase()];
    if (mapped) return mapped;
  }

  return "auto";
}

/**
 * Whether sync should write the baseline tarball.
 *
 * | Mode   | Behavior                                      |
 * |--------|-----------------------------------------------|
 * | always | Every sync writes archive                     |
 * | never  | Manifest only                                 |
 * | auto   | Archive when missing or git HEAD drift (default) |
 */
export async function shouldWriteArchive(
  repoRoot: string,
  argv: string[] = Bun.argv,
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>
): Promise<boolean> {
  const mode = resolveArchiveMode(argv, env);
  if (mode === "always") return true;
  if (mode === "never") return false;

  const archivePath = syncBaselineCacheArchivePath(repoRoot);
  if (!(await Bun.file(archivePath).exists())) return true;

  const [manifest, currentHead] = await Promise.all([readManifest(), getRepoHead()]);
  if (manifest?.gitHead !== currentHead) return true;

  return false;
}

/**
 * @deprecated Prefer resolveArchiveMode + shouldWriteArchive. True when mode is not `never`.
 */
export function resolveSyncWriteArchive(
  argv: string[] = Bun.argv,
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>
): boolean {
  return resolveArchiveMode(argv, env) !== "never";
}

export interface FinalizeSyncArchiveResult {
  manifest: ToolchainManifest;
  archived: boolean;
  archiveHash?: string;
  byteLength?: number;
  fileCount: number;
}

/** Write sync manifest; optionally append gzip baseline archive before sync exits. */
export async function finalizeSyncArchive(
  repoRoot: string,
  options: FinalizeSyncArchiveOptions
): Promise<FinalizeSyncArchiveResult> {
  const fileOpts = { files: options.files };
  const manifest = await writeSyncManifest(repoRoot, fileOpts);
  const fileCount = Object.keys(manifest.fileHashes ?? {}).length;

  const writeArchive = options.writeArchive ?? (await shouldWriteArchive(repoRoot));

  if (!writeArchive) {
    return { manifest, archived: false, fileCount };
  }

  if (!archiveSupported()) {
    console.error("[sync] Bun.Archive not available — skipping baseline archive");
    return { manifest, archived: false, fileCount };
  }

  const archivePath = options.archivePath ?? syncBaselineCacheArchivePath(repoRoot);
  const { archiveHash, byteLength } = await writeSyncArchiveBaseline(
    repoRoot,
    archivePath,
    manifest
  );

  console.log(`[sync] baseline archived ${byteLength} bytes | crc32 ${archiveHash}`);

  const metrics = await recordSyncBaselineMetrics(repoRoot, {
    ok: true,
    archivePath,
    syncBaselineSize: byteLength,
    syncBaselineHash: archiveHash,
    fileCount,
    toolchainVersion: manifest.toolchainVersion,
    lastSyncedAt: manifest.lastSyncedAt,
  });
  if (metrics?.hashChanged) {
    const delta =
      metrics.sizeDelta === 0
        ? "same size"
        : `${metrics.sizeDelta > 0 ? "+" : ""}${metrics.sizeDelta} B`;
    console.log(
      `[sync] baseline hash changed ${metrics.previousSyncBaselineHash} → ${archiveHash} (${delta})`
    );
  }

  return { manifest, archived: true, archiveHash, byteLength, fileCount };
}
