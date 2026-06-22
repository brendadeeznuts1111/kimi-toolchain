#!/usr/bin/env bun
/**
 * check-template-policy.ts — Template install, tsconfig, bun-native, and typecheck gate.
 *
 * Usage:
 *   bun run check:template-policy
 *   bun run check:template-policy --dry-run
 *   bun run check:template-policy --json
 */

import {
  auditTemplatePolicy,
  defaultTemplatePolicyRoot,
  TEMPLATE_POLICY_CHECK_IDS,
  templatePolicyDryRunSummary,
} from "../src/lib/template-policy-audit.ts";

const ROOT = defaultTemplatePolicyRoot();
const DRY_RUN = Bun.argv.includes("--dry-run");
const JSON_MODE = Bun.argv.includes("--json");

async function main(): Promise<number> {
  if (DRY_RUN) {
    const summary = {
      tool: "check-template-policy",
      mode: "dry-run",
      projectRoot: ROOT,
      ...(await templatePolicyDryRunSummary(ROOT)),
      checks: [...TEMPLATE_POLICY_CHECK_IDS],
      checkCount: TEMPLATE_POLICY_CHECK_IDS.length,
    };
    if (JSON_MODE) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(
        `check:template-policy dry-run — would verify ${summary.bunfigFiles} bunfig, ` +
          `${summary.templatePackages} packages, ${summary.registryEntries} registry entries, ` +
          `${summary.scaffoldFiles} scaffold + toolchain, ${summary.moduleSlices} module slices, ` +
          `${summary.envExampleFiles} env.example, ${summary.tsconfigProjects} tsconfig + modules, ` +
          `${summary.testProjects} test project(s), readme + oxlint + secrets + bun-native + tsc + bun test`
      );
    }
    return 0;
  }

  const result = await auditTemplatePolicy(ROOT);

  if (JSON_MODE) {
    console.log(JSON.stringify(result, null, 2));
    return result.violations.length > 0 ? 1 : 0;
  }

  if (result.violations.length > 0) {
    console.error(`❌ ${result.violations.length} template policy violation(s):\n`);
    for (const v of result.violations) {
      console.error(`  ✗ ${v.file}: [${v.field}] ${v.message}`);
    }
    console.error();
    return 1;
  }

  const s = result.summary;
  console.log(
    `✅ Template policy OK — ${s.bunfigFiles} bunfig, ${s.registryEntries} registry, ` +
      `${s.scaffoldFiles} scaffold + toolchain, ${s.moduleSlices} module slices, ` +
      `${s.envExampleFiles} env.example, ${s.tsconfigProjects} tsconfig + modules (${s.moduleTsFiles} module TS), ` +
      `${s.testProjects} test project(s), ${s.templateTsFiles} TS bun-native clean`
  );
  return 0;
}

process.exit(await main());
