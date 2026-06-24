#!/usr/bin/env bun
/**
 * Bun hygiene scan — type-safety + Bun-native hints (no-as-any, no-double-cast, node-fs).
 *
 *   bun run scripts/bun-hygiene-scan.ts
 *   bun run scripts/bun-hygiene-scan.ts --fail-on
 *   bun run scripts/bun-hygiene-scan.ts --json
 *   bun run scripts/bun-hygiene-scan.ts --path src
 */

import { join } from "path";
import { $ } from "bun";
import { writeStdoutJsonSync } from "../src/lib/ndjson.ts";
import {
  BUN_HYGIENE_RULES,
  evaluateHits,
  formatViolations,
  type AstGrepHit,
  type GateViolation,
} from "../src/lib/ast-grep-gate.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const CONFIG_PATH = join(REPO_ROOT, "sgconfig.yml");
const DEFAULT_PATHS = ["src", "scripts"];

interface CliOptions {
  json: boolean;
  failOn: boolean;
  paths: string[];
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { json: false, failOn: false, paths: [...DEFAULT_PATHS] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") opts.json = true;
    else if (arg === "--fail-on") opts.failOn = true;
    else if (arg === "--path" && argv[i + 1]) {
      opts.paths = [argv[++i]!];
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Bun hygiene scan — ${BUN_HYGIENE_RULES.join(", ")}

  --fail-on   Exit 1 when any non-exempt warning/hint remains
  --json      JSON summary to stdout
  --path DIR  Scan scope (default: src + scripts)
`);
      process.exit(0);
    }
  }
  return opts;
}

async function runHygieneScan(paths: string[]): Promise<AstGrepHit[]> {
  const absPaths = paths.map((p) => join(REPO_ROOT, p));
  const filter = BUN_HYGIENE_RULES.join("|");
  const start = Bun.nanoseconds();
  const stdout =
    await $`ast-grep scan -c ${CONFIG_PATH} --json --include-metadata --filter ${filter} ${absPaths}`
      .cwd(REPO_ROOT)
      .text();
  const durationMs = Math.round((Bun.nanoseconds() - start) / 1_000_000);
  const hits = JSON.parse(stdout || "[]") as AstGrepHit[];
  for (const hit of hits) {
    (hit as AstGrepHit & { durationMs?: number }).durationMs = durationMs;
  }
  return hits;
}

function summarize(violations: GateViolation[]): Record<string, number> {
  const byRule: Record<string, number> = {};
  for (const v of violations) {
    byRule[v.ruleId] = (byRule[v.ruleId] ?? 0) + 1;
  }
  return byRule;
}

async function main(): Promise<number> {
  const opts = parseArgs(Bun.argv.slice(2));
  const hits = await runHygieneScan(opts.paths);
  const { violations, exempted } = evaluateHits(hits, REPO_ROOT);
  const byRule = summarize(violations);

  const summary = {
    paths: opts.paths,
    total: violations.length,
    exempt: exempted.length,
    byRule,
    failOn: opts.failOn,
  };

  if (opts.json) {
    writeStdoutJsonSync({ summary, violations, exempted }, 2);
    return opts.failOn && violations.length > 0 ? 1 : 0;
  }

  const status = violations.length === 0 ? "✓ PASS" : opts.failOn ? "✗ FAIL" : "⚠ WARN";
  console.log(
    `  ${status} bun-hygiene — ${violations.length} finding(s), ${exempted.length} exempt`
  );
  for (const [rule, count] of Object.entries(byRule).sort()) {
    console.log(`    ${rule}: ${count}`);
  }
  if (violations.length > 0) {
    console.error(formatViolations(violations.slice(0, 20)));
    if (violations.length > 20) {
      console.error(`  … and ${violations.length - 20} more`);
    }
  }

  return opts.failOn && violations.length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("bun-hygiene-scan failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
