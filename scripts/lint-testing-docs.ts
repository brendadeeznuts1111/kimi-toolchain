#!/usr/bin/env bun
/**
 * lint-testing-docs.ts — Agent-facing testing doc hygiene gate.
 *
 * Encodes the manual `rg` audit recipes from test/testing.md.
 */

import { join } from "path";
import {
  auditTestingDocs,
  formatTestingDocReport,
  inventoryBunTestMentions,
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
