#!/usr/bin/env bun
/**
 * check-completion-drift.ts
 *
 * CI gate that ensures completions/COMPLETION_MATRIX.md is aligned with
 * completions/bun-cli.json.
 */

import { readText } from "../src/lib/bun-io.ts";

const ROOT = import.meta.dir.endsWith("scripts") ? `${import.meta.dir}/..` : import.meta.dir;
const JSON_PATH = `${ROOT}/completions/bun-cli.json`;
const MATRIX_PATH = `${ROOT}/completions/COMPLETION_MATRIX.md`;

function sha256Short(input: string): string {
  return Bun.SHA256.hash(input, "hex").slice(0, 12);
}

function main(): void {
  const rawJson = readText(JSON_PATH);
  const jsonHash = sha256Short(rawJson);
  const matrixContent = readText(MATRIX_PATH);

  // Check 1: Matrix contains current JSON hash
  if (!matrixContent.includes(jsonHash)) {
    console.error(`❌ Drift detected: ${JSON_PATH} hash (${jsonHash}) not found in matrix`);
    console.error(`   Run: bun run scripts/make-completion-matrix.ts`);
    process.exit(1);
  }

  // Check 2: Every top-level command in JSON has a matrix row
  const data = JSON.parse(rawJson);
  const jsonCommands = new Set(Object.keys(data.commands));
  const matrixCommands = new Set(
    [...matrixContent.matchAll(/^\|\s*`?(\w+)`?\s*\|/gm)].map((m) => m[1])
  );
  const missing = [...jsonCommands].filter((c) => !matrixCommands.has(c));

  if (missing.length > 0) {
    console.error(`❌ Missing commands in matrix: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log(`✅ Completion matrix aligned with ${JSON_PATH} (${jsonHash})`);
}

if (import.meta.main) {
  main();
}
