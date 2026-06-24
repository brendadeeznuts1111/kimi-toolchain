#!/usr/bin/env bun
/**
 * ast-grep scan gate — runs structural lint rules from sgconfig.yml.
 *
 *   bun run scripts/ast-grep-scan.ts              # gate (errors fail, warnings report)
 *   bun run scripts/ast-grep-scan.ts --json        # JSON to stdout
 *   bun run scripts/ast-grep-scan.ts --no-report   # skip writing reports/ files
 *   bun run scripts/ast-grep-scan.ts --list-rules  # show rule inventory
 *
 * Rule files: ast-grep-rules/*.yml
 * Config:     sgconfig.yml
 * Report:     reports/gate-report.{json,html}
 */

import { join } from "path";
import { writeStdoutJsonSync } from "../src/lib/ndjson.ts";
import {
  EXEMPT_FILES,
  formatViolations,
  runAstGrepGate,
  type GateReport,
} from "../src/lib/ast-grep-gate.ts";
import { pathExists } from "../src/lib/bun-io.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const CONFIG_PATH = join(REPO_ROOT, "sgconfig.yml");

interface CliOptions {
  json: boolean;
  report: boolean;
  listRules: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { json: false, report: true, listRules: false };
  for (const arg of argv) {
    if (arg === "--json") opts.json = true;
    else if (arg === "--no-report") opts.report = false;
    else if (arg === "--list-rules") opts.listRules = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`ast-grep scan gate — structural lint via sgconfig.yml

  --json         Emit JSON report to stdout
  --no-report    Skip writing reports/gate-report.{json,html}
  --list-rules   List rule IDs and exempt files
  --help, -h     Show this help
`);
      process.exit(0);
    }
  }
  return opts;
}

function printRuleInventory(): void {
  console.log("ast-grep rules:\n");
  for (const [ruleId, exempt] of Object.entries(EXEMPT_FILES)) {
    const exemptStr = exempt.length > 0 ? ` (exempt: ${exempt.join(", ")})` : "";
    console.log(`  ${ruleId}${exemptStr}`);
  }
}

async function main(): Promise<number> {
  const opts = parseArgs(Bun.argv.slice(2));

  if (opts.listRules) {
    printRuleInventory();
    return 0;
  }

  if (!pathExists(CONFIG_PATH)) {
    console.error(`ast-grep-scan: sgconfig.yml not found at ${CONFIG_PATH}`);
    return 1;
  }

  const { report, exitCode } = await runAstGrepGate({
    configPath: CONFIG_PATH,
    projectRoot: REPO_ROOT,
    json: opts.json,
    report: opts.report,
  });

  if (opts.json) {
    writeStdoutJsonSync(report, 2);
    return exitCode;
  }

  printSummary(report, opts.report);

  if (report.violations.length > 0) {
    console.error(formatViolations(report.violations));
  }

  return exitCode;
}

function printSummary(report: GateReport, wroteReport: boolean): void {
  const { total, errors, warnings, exempt, fail, durationMs } = report.summary;
  const status = fail ? "✗ FAIL" : "✓ PASS";
  console.log(
    `  ${status} ast-grep gate — ${total} violation(s): ${errors} error(s), ${warnings} warning(s), ${exempt} exempt (${durationMs}ms)`
  );
  if (wroteReport) {
    console.log(`  report: reports/gate-report.{json,html}`);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("ast-grep-scan failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
