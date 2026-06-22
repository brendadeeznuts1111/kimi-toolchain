#!/usr/bin/env bun
/**
 * verify-bun-features — runtime verification ritual for Bun-native doctor features.
 *
 * Usage:
 *   bun run verify:bun-features
 *   bun run verify:bun-features --json
 *   bun run verify:bun-features --strict
 *   bun run verify:bun-features --endpoints
 *   bun run verify:bun-features --profile
 */

import { resolveProjectRoot } from "../src/lib/utils.ts";
import { endpointCatalogSummary } from "../src/lib/audit-endpoints-metadata.ts";
import {
  countVerifyFailures,
  runVerifyBunFeatures,
  VERIFY_GROUP_LABELS,
  VERIFY_GROUP_ORDER,
  type VerifyCheck,
  type VerifyReport,
} from "../src/lib/verify-bun-features-runner.ts";

const argv = Bun.argv.slice(2);
const flags = {
  profile: argv.includes("--profile"),
  json: argv.includes("--json"),
  strict: argv.includes("--strict"),
  endpoints: argv.includes("--endpoints"),
  help: argv.includes("--help") || argv.includes("-h"),
};

const USAGE = `verify-bun-features — Bun-native doctor ritual

Usage:
  bun run verify:bun-features [--json] [--strict] [--endpoints] [--profile]

Flags:
  --json        Checks + endpoint catalog + probe metadata
  --strict      Fail when audit:config gates drift (like audit:config)
  --endpoints   Print endpoint catalog only (CLI + HTTP metadata)
  --profile     Include cpu-prof capture check
  --help        Show this help

Related:
  bun run audit:config
  bun run audit:dry-run
  bun run check:template-policy
  bun run check:templates
  bun run verify:bun-features:strict
`;

function icon(check: VerifyCheck): string {
  if (!check.ok) return "❌";
  if (check.advisory) return "⚠️";
  return "✅";
}

function printHumanReport(report: VerifyReport, strict: boolean): void {
  for (const group of VERIFY_GROUP_ORDER) {
    const groupChecks = report.checks.filter((c) => c.group === group);
    if (groupChecks.length === 0) continue;
    console.log(`\n${VERIFY_GROUP_LABELS[group]} (${groupChecks.length})`);
    console.log("─".repeat(44));
    for (const c of groupChecks) {
      console.log(`${icon(c)} ${c.id} — ${c.detail} (${c.ms}ms)`);
    }
  }

  const cat = report.metadata.endpointCatalog;
  console.log("\n" + "─".repeat(44));
  console.log(
    `Endpoints: ${cat.cli} CLI · ${cat.http.dashboard} HTTP (${cat.http.curated} curated) · ${report.endpoints.probes.length} probed`
  );
  console.log(
    `Summary: ${report.summary.passed}/${report.summary.total} passed · ${report.summary.failed} failed` +
      (report.summary.advisory > 0 ? ` · ${report.summary.advisory} advisory` : "") +
      ` · ${report.summary.durationMs}ms`
  );
  if (report.summary.configAligned === true) {
    console.log("config: aligned (audit:config gates pass)");
  } else if (report.summary.configAligned === false) {
    console.log(
      strict
        ? "config: drift — run bun run audit:config"
        : "config: drift (advisory — use --strict to fail)"
    );
  }

  const failures = countVerifyFailures(report, strict);
  console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} check(s) failed`);
}

async function main(): Promise<number> {
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  if (flags.endpoints) {
    const cat = endpointCatalogSummary();
    console.log(JSON.stringify(cat, null, 2));
    return 0;
  }

  const projectRoot = await resolveProjectRoot(Bun.cwd);
  process.chdir(projectRoot);

  const report = await runVerifyBunFeatures({
    strict: flags.strict,
    profile: flags.profile,
    projectRoot,
  });
  const failures = countVerifyFailures(report, flags.strict);

  if (flags.json) {
    console.log(JSON.stringify({ ...report, strict: flags.strict, failures }, null, 2));
  } else {
    printHumanReport(report, flags.strict);
  }

  return failures;
}

const code = await main();
if (code !== 0) process.exit(code);
