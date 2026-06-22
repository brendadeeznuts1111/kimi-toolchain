#!/usr/bin/env bun
/**
 * Validate bun-create template constraints (registry slice of template policy).
 *
 * Usage:
 *   bun run check:templates
 *   bun run check:templates --dry-run
 */

import {
  auditTemplateRegistry,
  defaultTemplatePolicyRoot,
  templatePolicyDryRunSummary,
} from "../src/lib/template-policy-audit.ts";

const ROOT = defaultTemplatePolicyRoot();
const DRY_RUN = Bun.argv.includes("--dry-run");
const JSON_MODE = Bun.argv.includes("--json");

async function main(): Promise<void> {
  if (DRY_RUN) {
    const summary = await templatePolicyDryRunSummary(ROOT);
    const payload = {
      tool: "check-templates",
      mode: "dry-run",
      registryEntries: summary.registryEntries,
      templatePackages: summary.templatePackages,
    };
    if (JSON_MODE) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(
        `check:templates dry-run — would validate ${summary.templatePackages} bun-create template(s) against ${summary.registryEntries} registry entries`
      );
    }
    return;
  }

  const violations = await auditTemplateRegistry(ROOT);
  if (violations.length > 0) {
    console.error(`\n❌ ${violations.length} template violation(s)`);
    for (const v of violations) {
      console.error(`  ✗ ${v.file}: [${v.field}] ${v.message}`);
    }
    process.exit(1);
  }

  const summary = await templatePolicyDryRunSummary(ROOT);
  console.log(`✅ All ${summary.templatePackages} templates validated`);
}

main().catch((err) => {
  console.error("check-templates failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
