#!/usr/bin/env bun
/**
 * skills-table.ts — Print repo skill catalog as Bun.inspect.table.
 *
 * Usage:
 *   bun run skills:table
 *   bun run skills:table --sort width
 *   bun run skills:table --verbose
 *   bun run scripts/skills-table.ts --json
 */

import { join } from "path";
import { auditSkillCoverage } from "../src/lib/skill-contract.ts";
import {
  buildSkillCoverageDetails,
  buildSkillTableRows,
  formatSkillTable,
  SKILL_TABLE_COLUMNS,
  SKILL_TABLE_VERBOSE_COLUMNS,
  SkillCatalog,
  sortSkillTableRows,
  type SkillTableSortMode,
} from "../src/lib/skill-table.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const json = Bun.argv.includes("--json");
const useCustom = Bun.argv.includes("--custom");
const verbose = Bun.argv.includes("--verbose");

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
  const built = await buildSkillTableRows(REPO_ROOT, report.rows, { verbose });
  const rows = sortSkillTableRows(built, sort);
  const details = buildSkillCoverageDetails(report.rows);

  if (json) {
    console.log(
      JSON.stringify({
        schemaVersion: 2,
        tool: "skills-table",
        ok: report.ok,
        sort,
        verbose,
        columns: verbose ? SKILL_TABLE_VERBOSE_COLUMNS : SKILL_TABLE_COLUMNS,
        rows,
        skills: details,
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

  console.log(formatSkillTable(rows, verbose));
  return 0;
}

const code = await main();
process.exit(code);
