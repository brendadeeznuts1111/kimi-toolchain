#!/usr/bin/env bun
/**
 * Bun upgrade advisor — scans a project for legacy patterns and suggests
 * Bun-native replacements.
 *
 * Usage:
 *   bun run scripts/scan.ts [path]       # human report (advisory, exit 0)
 *   bun run scripts/scan.ts --json       # structured UpgradeScanReport
 *   bun run scripts/scan.ts --brief      # one-line summary (check:fast)
 *   bun run scripts/scan.ts --exit-code    # exit 1 when findings exist (gate mode)
 *   bun run scripts/scan.ts --rule <id>    # single rule
 *
 * @see src/lib/upgrade-advisor.ts
 */

import { resolve } from "path";
import { pathExists } from "../src/lib/bun-io.ts";
import {
  formatUpgradeReportHuman,
  scanUpgradeAdvisor,
  UPGRADE_ADVISOR_RULE_IDS,
  type UpgradeAdvisorRuleId,
} from "../src/lib/upgrade-advisor.ts";

function parseArgs(argv: string[]): {
  projectRoot: string;
  jsonMode: boolean;
  exitOnFindings: boolean;
  brief: boolean;
  rules?: UpgradeAdvisorRuleId[];
} {
  let jsonMode = false;
  let exitOnFindings = false;
  let brief = false;
  let rules: UpgradeAdvisorRuleId[] | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") {
      jsonMode = true;
      continue;
    }
    if (arg === "--exit-code") {
      exitOnFindings = true;
      continue;
    }
    if (arg === "--brief") {
      brief = true;
      continue;
    }
    if (arg === "--rule") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--rule requires a rule id");
      }
      if (!(UPGRADE_ADVISOR_RULE_IDS as readonly string[]).includes(next)) {
        throw new Error(`Unknown rule: ${next}`);
      }
      rules = [next as UpgradeAdvisorRuleId];
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    positional.push(arg);
  }

  const projectRoot = resolve(positional[0] ?? joinRepoRoot());
  return { projectRoot, jsonMode, exitOnFindings, brief, rules };
}

function joinRepoRoot(): string {
  return resolve(import.meta.dir, "..");
}

if (import.meta.main) {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const { projectRoot, jsonMode, exitOnFindings, brief, rules } = parsed;

  if (!pathExists(projectRoot)) {
    console.error(`Project path not found: ${projectRoot}`);
    process.exit(1);
  }

  const report = await scanUpgradeAdvisor(projectRoot, { rules });

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else if (brief) {
    if (report.summary.total === 0) {
      console.log("scan: ok (0 findings)");
    } else {
      const rules = Object.entries(report.summary.byRule)
        .map(([id, n]) => `${id}×${n}`)
        .join(", ");
      console.log(
        `scan: ${report.summary.total} finding(s) (${rules}) — run 'bun run scan' for details`
      );
    }
  } else {
    process.stdout.write(formatUpgradeReportHuman(report));
  }

  process.exit(exitOnFindings && report.summary.total > 0 ? 1 : 0);
}
