#!/usr/bin/env bun
/**
 * check-secret-resolution.ts — Doctor gate: verify every CLI bin that spawns
 * child processes calls resolveDevSecrets() (or a specific resolver) first.
 *
 * Rule: if you spawn, you resolve first.
 *
 * Usage:
 *   bun run scripts/check-secret-resolution.ts
 *   bun run scripts/check-secret-resolution.ts --json
 */

import { checkSecretIsolation } from "../src/doctor/secret-isolation.ts";

const args = process.argv.slice(2);
const JSON_MODE = args.includes("--json");
const ROOT = args.find((a) => !a.startsWith("--")) ?? ".";

async function main(): Promise<number> {
  const { issues, errorCount } = await checkSecretIsolation(ROOT);

  if (JSON_MODE) {
    console.log(JSON.stringify({ issues, count: issues.length }, null, 2));
  } else {
    if (errorCount === 0) {
      console.log("✓ All spawning CLI bins resolve secrets before spawning");
    } else {
      console.log(`✗ ${errorCount} bin(s) spawn without resolving secrets:\n`);
      for (const issue of issues) {
        console.log(`  ${issue.severity === "error" ? "✗" : "⚠"} ${issue.file}: ${issue.message}`);
      }
    }
  }

  return errorCount;
}

process.exit(await main());
