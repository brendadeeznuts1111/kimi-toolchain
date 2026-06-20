#!/usr/bin/env bun
/**
 * Bun-native lint gate with phased rollout — see bun-native-lint.toml.
 */

import { join } from "path";
import { pathExists, readTextAsync, writeTextAsync } from "../src/lib/bun-io.ts";
import { writeStdoutJsonSync } from "../src/lib/ndjson.ts";
import {
  buildBaselineFromViolations,
  defaultConfig,
  evaluateViolations,
  formatRuleCatalog,
  parseBaselineJson,
  parseConfigToml,
  scanRepo,
  shouldFailCheck,
  type BaselineFile,
  type BunNativeLintConfig,
  type Violation,
} from "../src/lib/bun-native-lint.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const CONFIG_PATH = join(REPO_ROOT, "bun-native-lint.toml");
const BASELINE_PATH = join(REPO_ROOT, ".bun-native-baseline.json");

interface CliOptions {
  report: boolean;
  updateBaseline: boolean;
  listRules: boolean;
  json: boolean;
  ruleFilter?: string;
  batchRule?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    report: false,
    updateBaseline: false,
    listRules: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--report" || arg === "--scan") opts.report = true;
    else if (arg === "--check") opts.report = false;
    else if (arg === "--update-baseline" || arg === "--baseline") opts.updateBaseline = true;
    else if (arg === "--list-rules") opts.listRules = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--rule" && argv[i + 1]) opts.ruleFilter = argv[++i];
    else if (arg === "--batch" && argv[i + 1]) opts.batchRule = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`Bun-native lint — phased enforcement (see bun-native-lint.toml)`);
}

async function loadConfig(): Promise<BunNativeLintConfig> {
  if (!pathExists(CONFIG_PATH)) return defaultConfig();
  return parseConfigToml(await readTextAsync(CONFIG_PATH));
}

async function loadBaseline(): Promise<BaselineFile | null> {
  if (!pathExists(BASELINE_PATH)) return null;
  return parseBaselineJson(await readTextAsync(BASELINE_PATH));
}

function filterViolations(violations: Violation[], ruleId?: string): Violation[] {
  if (!ruleId) return violations;
  return violations.filter((v) => v.ruleId === ruleId);
}

function printViolations(violations: Violation[], title: string): void {
  if (violations.length === 0) return;
  console.error(`${title} (${violations.length}):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} [${v.ruleId}] ${v.message}`);
    console.error(`    → ${v.replacement}`);
    console.error(`    ${v.snippet}\n`);
  }
}

async function main(): Promise<number> {
  const opts = parseArgs(Bun.argv.slice(2));
  const config = await loadConfig();
  const baseline = await loadBaseline();
  const gateMode = opts.report ? "report" : config.gateMode;
  const violations = await scanRepo(REPO_ROOT, config);
  const result = evaluateViolations(violations, config, baseline);

  if (opts.listRules) {
    const catalog = formatRuleCatalog(violations, config);
    if (opts.json) {
      writeStdoutJsonSync({ schemaVersion: 1, rules: catalog }, 2);
      return 0;
    }
    console.log("Rule catalog:\n");
    for (const rule of catalog) {
      console.log(
        `  ${rule.id.padEnd(22)} ${rule.mode.padEnd(8)} ${String(rule.count).padStart(4)}  ${rule.replacement}`
      );
    }
    return 0;
  }

  if (opts.updateBaseline) {
    const next = buildBaselineFromViolations(violations, config, baseline, opts.ruleFilter);
    await writeTextAsync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
    console.log(
      `  ✓ Updated baseline${opts.ruleFilter ? ` for "${opts.ruleFilter}"` : ""} (${next.entries.length} entries)`
    );
    return 0;
  }

  const displayViolations = filterViolations(violations, opts.batchRule);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          summary: {
            total: violations.length,
            enforce: result.enforceViolations.length,
            new: result.newViolations.length,
            fail: shouldFailCheck(result, config, gateMode),
          },
          violations: displayViolations,
        },
        null,
        2
      )
    );
    return shouldFailCheck(result, config, gateMode) ? 1 : 0;
  }

  if (opts.batchRule) {
    printViolations(displayViolations, `Batch: ${opts.batchRule}`);
    console.log(`  ${displayViolations.length} violation(s) for rule "${opts.batchRule}"`);
    return 0;
  }

  if (opts.report) {
    printViolations(violations, "Audit");
    console.log(`  ${violations.length} total`);
    return 0;
  }

  if (result.enforceViolations.length > 0) {
    printViolations(result.enforceViolations, "Enforce-mode violations");
  }
  if (result.newViolations.length > 0) {
    printViolations(result.newViolations, "New violations");
  }

  if (shouldFailCheck(result, config, gateMode)) {
    console.error(`\n✗ Bun-native gate failed`);
    return 1;
  }

  console.log(`  ✓ Bun-native gate ok (${result.baselinedViolations.length} baselined)`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("lint-bun-native failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
