#!/usr/bin/env bun
/**
 * skills-table.ts — Print repo skill catalog as Bun.inspect.table.
 *
 * Usage:
 *   bun run skills:table
 *   bun run skills:table --sort width
 *   bun run scripts/skills-table.ts --json
 */

import { join } from "path";
import { auditSkillCoverage } from "../src/lib/skill-contract.ts";
import {
  buildSkillTableRows,
  formatSkillTable,
  SKILL_TABLE_COLUMNS,
  SkillCatalog,
  sortSkillTableRows,
  type SkillTableSortMode,
} from "../src/lib/skill-table.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const json = Bun.argv.includes("--json");
const useCustom = Bun.argv.includes("--custom");

const SORT_MODES = new Set<SkillTableSortMode>(["name", "layer", "width"]);

function parseSortMode(argv: string[]): SkillTableSortMode | null {
  const idx = argv.indexOf("--sort");
  if (idx === -1 || idx + 1 >= argv.length) return "name";
  const mode = argv[idx + 1] as SkillTableSortMode;
  if (!SORT_MODES.has(mode)) return null;
  return mode;
}

async function main(): Promise<number> {
  const sort = parseSortMode(Bun.argv);
  if (!sort) {
    const bad = Bun.argv[Bun.argv.indexOf("--sort") + 1] ?? "(missing)";
    console.error(`Unknown --sort mode: ${bad} (use name|layer|width)`);
    return 1;
  }

  const report = await auditSkillCoverage(REPO_ROOT);
  const built = await buildSkillTableRows(REPO_ROOT, report.rows);
  const rows = sortSkillTableRows(built, sort);

  if (json) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        tool: "skills-table",
        ok: report.ok,
        sort,
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
