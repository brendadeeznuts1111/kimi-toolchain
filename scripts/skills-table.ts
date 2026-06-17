#!/usr/bin/env bun
/**
 * skills-table.ts — Print repo skill catalog as Bun.inspect.table.
 *
 * Usage:
 *   bun run skills:table
 *   bun run scripts/skills-table.ts --json
 */

import { join } from "path";
import { auditSkillCoverage } from "../src/lib/skill-contract.ts";
import {
  buildSkillTableRows,
  formatSkillTable,
  SKILL_TABLE_COLUMNS,
  SkillCatalog,
} from "../src/lib/skill-table.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const json = Bun.argv.includes("--json");
const useCustom = Bun.argv.includes("--custom");

async function main(): Promise<number> {
  const report = await auditSkillCoverage(REPO_ROOT);
  const rows = await buildSkillTableRows(REPO_ROOT, report.rows);

  if (json) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        tool: "skills-table",
        ok: report.ok,
        columns: SKILL_TABLE_COLUMNS,
        rows,
        coverage: {
          unmappedSkills: report.unmappedSkills,
          orchestrator: report.orchestrator,
        },
      })
    );
    return 0;
  }

  if (useCustom) {
    console.log(new SkillCatalog(rows));
    return 0;
  }

  console.log(formatSkillTable(rows));
  return 0;
}

const code = await main();
process.exit(code);
