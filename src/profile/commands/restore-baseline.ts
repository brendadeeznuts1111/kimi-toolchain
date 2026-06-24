/**
 * restore-baseline command — CLI adapter over lib restore APIs.
 */

import { resolve } from "path";
import {
  desktopRoot,
  syncBaselineArchivePath,
  syncBaselineCacheArchivePath,
} from "../../lib/paths.ts";
import {
  driftTableRows,
  restoreBaselineToDir,
  restoreSyncBaseline,
  type HashDiffResult,
  type RestoreBaselineToDirResult,
  type RestoreDriftRow,
} from "../../lib/restore-baseline.ts";
import { verifySyncManifest } from "../../lib/sync-manifest.ts";
import { resolveEffectiveWorkspaceRoot } from "../../lib/workspace-health.ts";
import type { ToolchainManifest } from "../../lib/version.ts";

export type RestoreMode = "manifest" | "extract";

export interface RestoreConfig {
  archivePath: string;
  repoRoot: string;
  mode: RestoreMode;
  targetDir: string;
  verify: boolean;
  dryRun: boolean;
  json: boolean;
}

export interface RestoreResult {
  mode: RestoreMode;
  archivePath: string;
  targetDir: string;
  dryRun: boolean;
  verified: boolean;
  manifest: ToolchainManifest;
  restoredFiles: string[];
  restored: number;
  drift: string[];
  hashDiff?: HashDiffResult;
  dryRunRows?: RestoreDriftRow[];
  wroteManifest?: boolean;
  manifestVerificationOk?: boolean;
}

export function buildRestoreDryRunRows(result: RestoreResult): RestoreDriftRow[] {
  if (result.dryRunRows?.length) return result.dryRunRows;
  return driftTableRows(result.drift);
}

export function printRestoreBaselineHelp(): void {
  const { root } = resolveEffectiveWorkspaceRoot(Bun.cwd);
  console.log(`Usage: kimi-toolchain restore-baseline [options]

Options:
  -a, --archive <path>   Baseline archive (default: .cache or ${syncBaselineArchivePath()})
      --to <dir>         Extract payloads to directory (enables extract mode)
  -t, --target <dir>     Alias for --to
  -n, --dry-run          Verify without writing (manifest or extract)
      --force            Skip hash verification (emergency override)
      --json             Emit JSON result
  -h, --help             Show this help

Default (no --to): restore manifest to ${desktopRoot()} using restoreSyncBaseline.
Extract mode (--to): extract archive payloads and verify manifest file hashes.

Default archive search: ${syncBaselineCacheArchivePath(root)} then ${syncBaselineArchivePath()}`);
}

function readFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function resolveDefaultArchivePath(repoRoot: string): Promise<string> {
  const cachePath = syncBaselineCacheArchivePath(repoRoot);
  if (await Bun.file(cachePath).exists()) return cachePath;
  return syncBaselineArchivePath();
}

export async function parseRestoreBaselineArgs(
  args: string[]
): Promise<RestoreConfig | { help: true }> {
  const { root: repoRoot } = resolveEffectiveWorkspaceRoot(Bun.cwd);
  let archivePath: string | undefined;
  let targetDir = ".";
  let extractMode = false;
  let verify = true;
  let dryRun = false;
  let json = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "-a" || arg === "--archive") {
      archivePath = readFlagValue(args, index, arg);
      index++;
      continue;
    }
    if (arg.startsWith("--archive=")) {
      archivePath = arg.slice("--archive=".length);
      continue;
    }
    if (arg === "--to" || arg === "-t" || arg === "--target") {
      targetDir = readFlagValue(args, index, arg);
      extractMode = true;
      index++;
      continue;
    }
    if (arg.startsWith("--to=") || arg.startsWith("--target=")) {
      targetDir = arg.includes("--to=") ? arg.slice("--to=".length) : arg.slice("--target=".length);
      extractMode = true;
      continue;
    }
    if (arg === "-n" || arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--force") {
      verify = false;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  const resolvedArchive = resolve(archivePath ?? (await resolveDefaultArchivePath(repoRoot)));

  return {
    archivePath: resolvedArchive,
    repoRoot,
    mode: extractMode ? "extract" : "manifest",
    targetDir: resolve(targetDir),
    verify,
    dryRun,
    json,
  };
}

function fromExtractResult(result: RestoreBaselineToDirResult, mode: RestoreMode): RestoreResult {
  return {
    mode,
    archivePath: result.archivePath,
    targetDir: result.targetDir,
    dryRun: result.dryRun,
    verified: result.verified,
    manifest: result.manifest,
    restoredFiles: result.restoredFiles,
    restored: result.restored,
    drift: result.drift,
  };
}

/** Dispatch manifest restore (restoreSyncBaseline) or extract restore (restoreBaselineToDir). */
export async function restoreBaseline(cfg: RestoreConfig): Promise<RestoreResult> {
  if (cfg.mode === "extract") {
    const result = await restoreBaselineToDir(cfg.archivePath, cfg.targetDir, {
      verify: cfg.verify,
      dryRun: cfg.dryRun,
    });
    const extract = fromExtractResult(result, "extract");
    extract.dryRunRows = driftTableRows(extract.drift);
    return extract;
  }

  const syncResult = await restoreSyncBaseline({
    archivePath: cfg.archivePath,
    repoRoot: cfg.repoRoot,
    verify: cfg.verify,
    dryRun: cfg.dryRun,
  });

  let manifestVerificationOk: boolean | undefined;
  if (!cfg.dryRun && syncResult.wroteManifest && cfg.verify) {
    const report = await verifySyncManifest(cfg.repoRoot);
    manifestVerificationOk = report.ok;
    if (!report.ok) {
      throw new Error("verifySyncManifest failed after restore");
    }
  }

  const hashDiff = syncResult.hashDiff;
  return {
    mode: "manifest",
    archivePath: cfg.archivePath,
    targetDir: desktopRoot(),
    dryRun: cfg.dryRun,
    verified: cfg.verify,
    manifest: syncResult.manifest,
    restoredFiles: [],
    restored: syncResult.meta.fileCount,
    drift: [],
    hashDiff,
    dryRunRows: syncResult.driftRows ?? [],
    wroteManifest: syncResult.wroteManifest,
    manifestVerificationOk,
  };
}
