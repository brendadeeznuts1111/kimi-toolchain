#!/usr/bin/env bun
/**
 * Secrets storage tier gate — blocks check when Linux env-fallback has policy mismatches.
 *
 *   bun run scripts/secrets-storage-gate.ts
 */

import { join } from "path";
import { runSecretsStorageGate } from "../src/lib/secrets-gate.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const result = await runSecretsStorageGate(REPO_ROOT);

if (result.skipped) {
  console.log(`secrets-storage-gate skipped: ${result.message}`);
  process.exit(0);
}

if (!result.ok) {
  console.error(`secrets-storage-gate failed: ${result.message}`);
  if (result.taxonomyId) console.error(`taxonomy: ${result.taxonomyId}`);
  process.exit(1);
}

console.log(`secrets-storage-gate OK: ${result.message}`);
