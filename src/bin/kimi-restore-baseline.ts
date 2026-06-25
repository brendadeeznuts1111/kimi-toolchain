#!/usr/bin/env bun
/**
 * kimi-restore-baseline — CLI entry for restore-baseline command.
 */

import { isDirectRun } from "../lib/bun-utils.ts";
import { writeStdoutJsonSync } from "../lib/ndjson.ts";
import {
  parseRestoreBaselineArgs,
  printRestoreBaselineHelp,
  printRestoreDryRunTable,
  restoreBaseline,
  type HashDiffResult,
  type RestoreDriftRow,
} from "../lib/desktop-sync.ts";

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
      if (driftRows?.length) printRestoreDryRunTable(driftRows);
      if (hashDiff && parsed.mode === "manifest") {
        console.error("[restore] verifySyncManifest: FAILED — hash mismatch");
      }
    }
    throw err;
  }

  if (parsed.json) {
    writeStdoutJsonSync({ ...result, dryRunRows: dryRunRows(result) }, 2);
    return 0;
  }

  if (parsed.dryRun) {
    printRestoreDryRunTable(dryRunRows(result));
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
    return 0;
  }

  const action = parsed.dryRun ? "verified" : "restored";
  console.error(`[restore] ${action} ${result.restored} file(s) from ${result.archivePath}`);
  console.error(`[restore] target: ${result.targetDir}`);
  if (result.verified) console.error("[restore] verification passed");
  return 0;
}

if (isDirectRun(import.meta.path)) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("[restore]", err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
