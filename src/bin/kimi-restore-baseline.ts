#!/usr/bin/env bun
/**
 * kimi-restore-baseline — CLI entry for restore-baseline command.
 *
 * Usage:
 *   kimi-toolchain restore-baseline --dry-run
 *   kimi-toolchain restore-baseline --archive ./.cache/sync-baseline.tar.gz --to ./dist
 */

import { writeStdoutJsonSync } from "../lib/ndjson.ts";
import {
  buildRestoreDryRunRows,
  parseRestoreBaselineArgs,
  printRestoreBaselineHelp,
  restoreBaseline,
} from "../profile/commands/restore-baseline.ts";
import {
  driftTableRows,
  printRestoreDryRunTable,
  type HashDiffResult,
  type RestoreDriftRow,
} from "../lib/restore-baseline.ts";
async function main(): Promise<number> {
  const parsed = await parseRestoreBaselineArgs(Bun.argv.slice(2));
  if ("help" in parsed) {
    printRestoreBaselineHelp();
    return 0;
  }

  let result;
  try {
    result = await restoreBaseline(parsed);
  } catch (err) {
    if (parsed.dryRun && !parsed.json) {
      const driftRows = (err as Error & { driftRows?: RestoreDriftRow[] }).driftRows;
      const hashDiff = (err as Error & { hashDiff?: HashDiffResult }).hashDiff;
      const drift = (err as Error & { drift?: string[] }).drift;
      if (driftRows?.length) printRestoreDryRunTable(driftRows);
      else if (drift) printRestoreDryRunTable(driftTableRows(drift));
      if (hashDiff && parsed.mode === "manifest") {
        console.error("[restore] verifySyncManifest: FAILED — hash mismatch");
      }
    }
    throw err;
  }

  if (parsed.json) {
    writeStdoutJsonSync(
      {
        ...result,
        dryRunRows: result.dryRunRows ?? buildRestoreDryRunRows(result),
      },
      2
    );
    return 0;
  }

  if (parsed.dryRun) {
    printRestoreDryRunTable(result.dryRunRows ?? buildRestoreDryRunRows(result));
    if (result.mode === "manifest") {
      console.error("[restore] baseline dry-run passed (archive hashes match repo)");
      return 0;
    }
  }

  if (result.mode === "manifest") {
    const action = parsed.dryRun ? "verified" : "restored manifest to";
    console.error(`[restore] ${action} ${result.targetDir}`);
    console.error(`[restore] archive: ${result.archivePath}`);
    console.error(`[restore] file hashes: ${result.restored}`);
    if (result.wroteManifest) console.error("[restore] manifest written");
    if (result.manifestVerificationOk) console.error("[restore] verifySyncManifest passed");
    if (result.verified && !parsed.dryRun) console.error("[restore] verification passed");
    return 0;
  }

  const action = parsed.dryRun ? "verified" : "restored";
  console.error(`[restore] ${action} ${result.restored} file(s) from ${result.archivePath}`);
  console.error(`[restore] target: ${result.targetDir}`);
  if (result.verified) console.error("[restore] verification passed");
  return 0;
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("[restore]", err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
