#!/usr/bin/env bun
/**
 * Advisory lockfile wrapper around the synced runtime guardian.
 *
 * Invokes the synced runtime copy (~/.kimi-code/tools/kimi-guardian.ts) and parses
 * its output for hash mismatch strings. Exits 0 by default (advisory); use --exit-code
 * to force a non-zero exit on failure.
 *
 * Pre-push hooks use hook-gates.ts + the repo binary instead.
 */

import { $ } from "bun";
import { join } from "path";
import { toolsDir } from "../lib/paths.ts";

const args = process.argv.slice(2);
const exitOnFail = args.includes("--exit-code");
const guardianPath = join(toolsDir(), "kimi-guardian.ts");

export function evaluateGuardianVerifyOutput(
  output: string,
  exitOnFail: boolean
): { exitCode: number; lines: string[] } {
  const lines = output.split("\n").filter((line) => line.trim().length > 0);

  const hashError = lines.some((line) => /HASH MISMATCH|No stored hash/i.test(line));
  const hasNoSignedManifest = lines.some((line) => /No signed manifest/i.test(line));
  const success = !hashError;

  if (success) {
    return {
      exitCode: 0,
      lines: ["✓ Lockfile integrity verified"],
    };
  }

  const hints: string[] = [];
  hints.push("Run 'kimi-guardian fix' to baseline the hash");
  if (hasNoSignedManifest) {
    hints.push("Run 'kimi-guardian sign' for v2 signed manifest protection");
  }

  return {
    exitCode: exitOnFail ? 1 : 0,
    lines: hints,
  };
}

if (import.meta.main) {
  const result = await $`bun run ${guardianPath} check`.nothrow().quiet();
  const output = [result.stdout.toString(), result.stderr.toString()].join("\n");
  const { exitCode, lines } = evaluateGuardianVerifyOutput(output, exitOnFail);

  lines.forEach((line) => console.log(line));
  process.exit(exitCode);
}
