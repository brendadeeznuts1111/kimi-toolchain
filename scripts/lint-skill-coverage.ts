#!/usr/bin/env bun
/**
 * lint-skill-coverage.ts — Skill ↔ code contract and coverage gate.
 *
 * Usage:
 *   bun run lint:skills
 *   bun run scripts/lint-skill-coverage.ts --json
 */

import { join } from "path";
import { auditSkillCoverage, formatSkillCoverageReport } from "../src/lib/skill-contract.ts";
import { buildSkillTableRows, formatSkillTable } from "../src/lib/skill-table.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const json = Bun.argv.includes("--json");

async function main(): Promise<number> {
  const report = await auditSkillCoverage(REPO_ROOT);

  if (json) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        tool: "lint-skill-coverage",
        ok: report.ok,
        rows: report.rows,
        codeIssues: report.codeIssues,
        unmappedSkills: report.unmappedSkills,
        orchestrator: report.orchestrator,
      })
    );
    return report.ok ? 0 : 1;
  }

  console.log(formatSkillCoverageReport(report));
  const tableRows = await buildSkillTableRows(REPO_ROOT, report.rows);
  console.log("");
  console.log(formatSkillTable(tableRows));
  return report.ok ? 0 : 1;
}

const code = await main();
process.exit(code);
