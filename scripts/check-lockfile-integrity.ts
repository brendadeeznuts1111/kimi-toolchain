#!/usr/bin/env bun
/**
 * check-lockfile-integrity.ts — CI gate: verify bun.lock is consistent with
 * package.json by running bun install --frozen-lockfile.
 *
 * Usage:
 *   bun run scripts/check-lockfile-integrity.ts
 */

import { spawnBun } from "../src/lib/tool-runner.ts";

async function main(): Promise<number> {
  const result = await spawnBun(["install", "--frozen-lockfile", "--ignore-scripts"], {
    cwd: ".",
    maxOutputBytes: 0,
  });

  if (result.exitCode === 0) {
    console.log("✅ Lockfile integrity verified — bun.lock matches package.json");
    return 0;
  }

  console.error("❌ Lockfile integrity check failed");
  console.error("   bun install --frozen-lockfile exited with code", result.exitCode);
  if (result.stderr) {
    console.error("   stderr:", result.stderr.slice(0, 500));
  }
  console.error("\n   Remediation: run 'bun install' and commit the updated bun.lock");
  return 1;
}

process.exit(await main());
