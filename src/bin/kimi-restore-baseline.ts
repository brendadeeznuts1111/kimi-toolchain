#!/usr/bin/env bun
/**
 * kimi-restore-baseline — CLI entry for restore-baseline command.
 */

import { Effect, Either } from "effect";
import { isDirectRun } from "../lib/bun-utils.ts";
import { writeStdoutJsonSync } from "../lib/ndjson.ts";
import { createLogger } from "../lib/logger.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import {
  parseRestoreBaselineArgs,
  printRestoreBaselineHelp,
  printRestoreDryRunTable,
  restoreBaseline,
  type HashDiffResult,
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