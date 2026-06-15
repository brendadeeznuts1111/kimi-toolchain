#!/usr/bin/env bun
/**
 * Require KIMI_TUNING_SET_VERSION bump when staged define constants change.
 *
 * Usage:
 *   bun run scripts/lint-tuning-set-version.ts --staged
 */

import { join } from "path";
import { lintTuningSetVersion } from "../src/lib/tuning-set-version.ts";

const ROOT = join(import.meta.dir, "..");

async function main(): Promise<void> {
  const staged = Bun.argv.includes("--staged");
  const result = await lintTuningSetVersion(ROOT, { staged });

  if (!result.ok) {
    console.error("lint:tuning-set-version failed:\n");
    for (const violation of result.violations) console.error(violation);
    process.exit(1);
  }

  if (staged) {
    console.log(
      "lint:tuning-set-version OK (staged define changes include version bump if needed)"
    );
  }
}

main().catch((err: Error) => {
  console.error("lint-tuning-set-version failed:", err.message);
  process.exit(1);
});
