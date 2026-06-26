#!/usr/bin/env bun
/**
 * kimi-restore-baseline — CLI entry for restore-baseline command.
 */

import { Effect, Either } from "effect";
import { resolve } from "path";
import { isDirectRun } from "../lib/bun-utils.ts";
import { writeStdoutJsonSync } from "../lib/ndjson.ts";
import { createLogger } from "../lib/logger.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import {
  desktopRoot,
  syncBaselineArchivePath,
  syncBaselineCacheArchivePath,
} from "../lib/paths.ts";
import { resolveEffectiveWorkspaceRoot } from "../lib/workspace-health.ts";
import {
  printRestoreDryRunTable,
  restoreBaseline,
  type HashDiffResult,
  type RestoreConfig,
  type RestoreDriftRow,
} from "../lib/desktop-sync.ts";

const logger = createLogger(Bun.argv, "kimi-restore-baseline");

function stderrLine(message: string): void {
  process.stderr.write(`${message}\n`);
}

function dryRunRows(result: {
  dryRunRows?: RestoreDriftRow[];
  drift: string[];
}): RestoreDriftRow[] {
  if (result.dryRunRows?.length) return result.dryRunRows;
  return result.drift.map((line) => ({
    file: line.replace(/^(missing|changed) /, ""),
    status: line.startsWith("missing ") ? ("remove" as const) : ("modify" as const),
  }));
}

function printRestoreBaselineHelp(): void {
  const { root } = resolveEffectiveWorkspaceRoot(Bun.cwd);
  logger.line(
    `Usage: kimi-toolchain restore-baseline [-a path] [--to dir] [-n] [--force] [--json]\n` +
      `Manifest mode → ${desktopRoot()}; extract mode with --to.\n` +
      `Archive: ${syncBaselineCacheArchivePath(root)} or ${syncBaselineArchivePath()}`
  );
}

async function resolveDefaultArchivePath(repoRoot: string): Promise<string> {
  const cachePath = syncBaselineCacheArchivePath(repoRoot);
  if (await Bun.file(cachePath).exists()) return cachePath;
  return syncBaselineArchivePath();
}

async function parseRestoreBaselineArgs(args: string[]): Promise<RestoreConfig | { help: true }> {
  const { root: repoRoot } = resolveEffectiveWorkspaceRoot(Bun.cwd);
  let archivePath: string | undefined;
  let targetDir = ".";
  let extractMode = false;
  let verify = true;
  let dryRun = false;
  let json = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "-a" || arg === "--archive") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) throw new Error(`${arg} requires a value`);
      archivePath = value;
      index++;
      continue;
    }
    if (arg.startsWith("--archive=")) {
      archivePath = arg.slice("--archive=".length);
      continue;
    }
    if (arg === "--to" || arg === "-t" || arg === "--target") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) throw new Error(`${arg} requires a value`);
      targetDir = value;
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

  return {
    archivePath: resolve(archivePath ?? (await resolveDefaultArchivePath(repoRoot))),
    repoRoot,
    mode: extractMode ? "extract" : "manifest",
    targetDir: resolve(targetDir),
    verify,
    dryRun,
    json,
  };
}

function formatRestoreError(err: unknown): CliError {
  return new CliError({
    message: err instanceof Error ? err.message : String(err),
  });
}

function restoreBaselineProgram(): Effect.Effect<number, CliError> {
  return Effect.gen(function* () {
    const parsed = yield* Effect.tryPromise({
      try: () => parseRestoreBaselineArgs(Bun.argv.slice(2)),
      catch: formatRestoreError,
    });
    if ("help" in parsed) {
      printRestoreBaselineHelp();
      return 0;
    }

    const outcome = yield* Effect.either(
      Effect.tryPromise({
        try: () => restoreBaseline(parsed),
        catch: (err) => err,
      })
    );

    if (Either.isLeft(outcome)) {
      const err = outcome.left;
      if (parsed.dryRun && !parsed.json) {
        const driftRows = (err as Error & { driftRows?: RestoreDriftRow[] }).driftRows;
        const hashDiff = (err as Error & { hashDiff?: HashDiffResult }).hashDiff;
        if (driftRows?.length) printRestoreDryRunTable(driftRows);
        if (hashDiff && parsed.mode === "manifest") {
          stderrLine("[restore] verifySyncManifest: FAILED — hash mismatch");
        }
      }
      return yield* Effect.fail(formatRestoreError(err));
    }

    const result = outcome.right;

    if (parsed.json) {
      writeStdoutJsonSync({ ...result, dryRunRows: dryRunRows(result) }, 2);
      return 0;
    }

    if (parsed.dryRun) {
      printRestoreDryRunTable(dryRunRows(result));
      if (result.mode === "manifest") {
        stderrLine("[restore] baseline dry-run passed (archive hashes match repo)");
        return 0;
      }
    }

    if (result.mode === "manifest") {
      const action = parsed.dryRun ? "verified" : "restored manifest to";
      stderrLine(`[restore] ${action} ${result.targetDir}`);
      stderrLine(`[restore] archive: ${result.archivePath}`);
      stderrLine(`[restore] file hashes: ${result.restored}`);
      if (result.wroteManifest) stderrLine("[restore] manifest written");
      if (result.manifestVerificationOk) stderrLine("[restore] verifySyncManifest passed");
      return 0;
    }

    const action = parsed.dryRun ? "verified" : "restored";
    stderrLine(`[restore] ${action} ${result.restored} file(s) from ${result.archivePath}`);
    stderrLine(`[restore] target: ${result.targetDir}`);
    if (result.verified) stderrLine("[restore] verification passed");
    return 0;
  });
}

if (isDirectRun(import.meta.path)) {
  const exitCode = await runCliExit(restoreBaselineProgram(), {
    toolName: "kimi-restore-baseline",
    logger,
  });
  process.exit(exitCode);
}
