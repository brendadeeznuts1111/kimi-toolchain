#!/usr/bin/env bun
/**
 * lint-testing-docs.ts — Agent-facing testing doc hygiene gate.
 *
 * Encodes the manual `rg` audit recipes from test/testing.md.
 */

import { join } from "path";
import {
  auditMarkdownFenceLanguages,
  auditMarkdownHeadings,
  auditTestTierInventory,
  auditTestingDocs,
  formatTestingDocReport,
  inventoryBunTestMentions,
  listMarkdownFences,
  TESTING_DOCS_AUDIT_COMMANDS,
  TESTING_DOCS_DEFAULT_PATHS,
} from "../src/lib/testing-docs-lint.ts";
import { readTextAsync } from "../src/lib/bun-io.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const json = Bun.argv.includes("--json");
const report = Bun.argv.includes("--report");

async function main(): Promise<number> {
  const issues = await auditTestingDocs(REPO_ROOT);

  if (report) {
    console.log("Manual audit commands:\n");
    for (const [key, cmd] of Object.entries(TESTING_DOCS_AUDIT_COMMANDS)) {
      console.log(`# ${key}\n${cmd}\n`);
    }
    console.log("bun test inventory (agent docs):\n");
    for (const rel of TESTING_DOCS_DEFAULT_PATHS) {
      if (!rel.endsWith(".md")) continue;
      const text = await readTextAsync(join(REPO_ROOT, rel));
      const hits = inventoryBunTestMentions(rel, text);
      if (hits.length === 0) continue;
      console.log(`${rel}:`);
      for (const hit of hits) {
        console.log(`  L${hit.line} ${hit.allowed ? "ok" : "review"}  ${hit.snippet}`);
      }
    }
    console.log("\nheading audit (agent docs, fence-aware; rg recipes above are repo-wide):\n");
    for (const rel of TESTING_DOCS_DEFAULT_PATHS) {
      if (!rel.endsWith(".md")) continue;
      const text = await readTextAsync(join(REPO_ROOT, rel));
      const headingIssues = auditMarkdownHeadings(rel, text);
      if (headingIssues.length === 0) continue;
      console.log(`${rel}:`);
      for (const issue of headingIssues) {
        console.log(`  L${issue.line} [${issue.severity}] ${issue.ruleId}  ${issue.snippet}`);
      }
    }
    console.log("\nfence languages (agent docs):\n");
    for (const rel of TESTING_DOCS_DEFAULT_PATHS) {
      if (!rel.endsWith(".md")) continue;
      const text = await readTextAsync(join(REPO_ROOT, rel));
      const fences = listMarkdownFences(text);
      if (fences.length === 0) continue;
      const fenceIssues = auditMarkdownFenceLanguages(rel, text);
      console.log(`${rel}: ${fences.length} fence(s)`);
      for (const issue of fenceIssues) {
        console.log(`  L${issue.line} [${issue.severity}] ${issue.ruleId}  ${issue.snippet}`);
      }
    }
    const tierIssues = await auditTestTierInventory(REPO_ROOT);
    const onDisk = tierIssues.filter((i) => i.ruleId === "test-file-not-in-tier-inventory").length;
    const stale = tierIssues.filter((i) => i.ruleId === "stale-test-gates-entry").length;
    console.log(
      `\ntest tier inventory: ${onDisk} orphan(s) on disk, ${stale} stale test-gates.ts entry(ies)`
    );
    for (const issue of tierIssues) {
      console.log(`  [${issue.severity}] ${issue.ruleId}  ${issue.snippet}`);
    }
    console.log(
      "\nOptional deep markdown lint (skipped levels, duplicates, trailing spaces):\n" +
        TESTING_DOCS_AUDIT_COMMANDS.markdownlintOptional
    );
    return 0;
  }

  const errors = issues.filter((i) => i.severity === "error");

  if (json) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        tool: "lint-testing-docs",
        ok: errors.length === 0,
        auditCommands: TESTING_DOCS_AUDIT_COMMANDS,
        issues,
      })
    );
    return errors.length === 0 ? 0 : 1;
  }

  console.log(formatTestingDocReport(issues));
  return errors.length === 0 ? 0 : 1;
}

const code = await main();
process.exit(code);
