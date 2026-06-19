#!/usr/bin/env bun
/**
 * Cross-repo define constant parity gate.
 *
 * Compares shared logical constants across configured repos (constants-parity.toml).
 * Skips sibling repos that are not checked out locally unless --strict is passed.
 *
 * Usage:
 *   bun run scripts/lint-constant-parity.ts
 *   bun run scripts/lint-constant-parity.ts --strict
 */

import { join } from "path";
import { lintConstantParity } from "../src/lib/constant-parity.ts";

const ROOT = join(import.meta.dir, "..");

async function main(): Promise<void> {
  const strict = Bun.argv.includes("--strict");
  const result = await lintConstantParity(ROOT, { strict });

  for (const warning of result.warnings) {
    console.warn(`warn: ${warning}`);
  }

  if (!result.ok) {
    console.error("lint:constant-parity failed:\n");
    for (const violation of result.violations) console.error(violation);
    process.exit(1);
  }

  const suffix = result.warnings.length > 0 ? ` (${result.warnings.length} skipped)` : "";
  console.log(`lint:constant-parity OK${suffix}`);
}

main().catch((err: Error) => {
  console.error("lint-constant-parity failed:", err.message);
  process.exit(1);
});
