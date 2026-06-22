#!/usr/bin/env bun
/**
 * check-env-drift.ts — CLI wrapper for src/lib/check-env-drift.ts.
 *
 * Detect drift between .env.example (committed template) and the local
 * gitignored .env file.
 *
 * Usage:
 *   bun scripts/check-env-drift.ts
 *   bun scripts/check-env-drift.ts --json
 *   bun scripts/check-env-drift.ts --fix   # append missing keys from .env.example
 *
 * Exit code: number of drifted keys (0 = in sync)
 */

import { applyFix, computeDrift, formatDrift, parseEnvKeys } from "../src/lib/check-env-drift.ts";

async function main(): Promise<number> {
  const JSON_MODE = process.argv.includes("--json");
  const FIX_MODE = process.argv.includes("--fix");
  const STRICT_MODE = process.argv.includes("--strict");

  const exampleFile = Bun.file(".env.example");
  if (!(await exampleFile.exists())) {
    if (JSON_MODE) {
      console.log(JSON.stringify({ error: ".env.example not found" }, null, 2));
    } else {
      console.error("✗ .env.example not found");
    }
    return 1;
  }

  const localFile = Bun.file(".env");
  const localExists = await localFile.exists();
  if (!localExists && !STRICT_MODE) {
    if (JSON_MODE) {
      console.log(JSON.stringify({ skipped: true, reason: ".env not present" }, null, 2));
    } else {
      console.log("ℹ No .env file to check (CI-safe skip)");
    }
    return 0;
  }

  const [exampleText, localText] = await Promise.all([
    exampleFile.text(),
    localExists ? localFile.text() : "",
  ]);

  const exampleKeys = parseEnvKeys(exampleText);
  const localKeys = parseEnvKeys(localText);
  const drift = computeDrift(exampleKeys, localKeys);

  if (FIX_MODE) {
    const fixedText = applyFix(drift, exampleText, localText);
    if (fixedText !== localText) {
      await Bun.write(".env", fixedText);
    }
    const updatedDrift = computeDrift(exampleKeys, parseEnvKeys(fixedText));
    if (JSON_MODE) {
      console.log(JSON.stringify({ fixed: true, drift: updatedDrift }, null, 2));
    } else {
      console.log(
        `✓ Synchronized ${drift.exampleOnly.length} missing key(s) from .env.example to .env`
      );
      if (updatedDrift.localOnly.length > 0) {
        console.log(`  Note: ${updatedDrift.localOnly.length} local-only key(s) remain in .env`);
      }
    }
    return 0;
  }

  if (JSON_MODE) {
    console.log(JSON.stringify(drift, null, 2));
  } else {
    console.log(formatDrift(drift));
  }

  return drift.exampleOnly.length + drift.localOnly.length;
}

if (import.meta.main) {
  process.exit(await main());
}
