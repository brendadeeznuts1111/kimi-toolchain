#!/usr/bin/env bun
/**
 * guardian/verify.ts — Lockfile integrity verifier
 * Thin wrapper around kimi-guardian for pre-push hook usage
 *
 * Usage:
 *   bun run src/guardian/verify.ts [--exit-code]  (from repo)
 */

import { $ } from "bun";
import { join } from "path";
import { Effect } from "effect";
import { toolsDir } from "../lib/paths.ts";

const GUARDIAN = join(toolsDir(), "kimi-guardian.ts");
const EXIT_ON_FAIL = Bun.argv.includes("--exit-code");

async function main(): Promise<number> {
  const result = await $`bun run ${GUARDIAN} check`.nothrow().quiet();
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  const output = stdout + stderr;

  const hasMismatch = output.includes("HASH MISMATCH") || output.includes("No stored hash");

  if (hasMismatch) {
    console.log("🚫 Lockfile integrity check FAILED");
    console.log("   Run 'kimi-guardian sign' to baseline");
    return EXIT_ON_FAIL ? 1 : 0;
  }

  console.log("✓ Lockfile integrity verified");
  return 0;
}

(async () => {
  try {
    const exitCode = await Effect.runPromise(
      Effect.tryPromise({
        try: () => main(),
        catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
      })
    );
    process.exit(exitCode);
  } catch (err) {
    console.error("Guardian verify failed:", err instanceof Error ? err.message : String(err));
    process.exit(EXIT_ON_FAIL ? 1 : 0);
  }
})();
