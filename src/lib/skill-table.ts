/**
 * skill-table.ts — Human-readable skill catalog table (Bun.inspect.table).
 */

import { basename, join } from "path";
import { customInspect, formatTable, sliceAnsi } from "./inspect.ts";
import type { SkillCoverageRow } from "./skill-contract.ts";

export type SkillTableSortMode = "name" | "layer" | "width";

export const LOADED_BY_MAX_COLS = 28;

/** Truncate text to fit a terminal column budget (Bun.sliceAnsi-aware). */
export function truncateDisplay(text: string, maxCols: number): string {
  if (Bun.stringWidth(text) <= maxCols) return text;
  return sliceAnsi(text, 0, maxCols, "…");
}

/** Sort skill table rows by name, layer, or skill display width. */
export function sortSkillTableRows(
  rows: SkillTableRow[],
  mode: SkillTableSortMode = "name"
): SkillTableRow[] {
  const sorted = [...rows];
  switch (mode) {
    case "width":
      return sorted.sort((a, b) => {
        const dw = Bun.stringWidth(a.skill) - Bun.stringWidth(b.skill);
        return dw !== 0 ? dw : a.skill.localeCompare(b.skill);
      });
    case "layer":
      return sorted.sort((a, b) => {
        const dl = a.layer.localeCompare(b.layer);
        return dl !== 0 ? dl : a.skill.localeCompare(b.skill);
      });
    case "name":
    default:
      return sorted.sort((a, b) => a.skill.localeCompare(b.skill));
  }
}

export interface SkillTableRow {
  skill: string;
  layer: string;
  lines: number;
  tokens: string;
  triggers: number;
  deps: number;
  loaded_by: string;
  contract: string;
  lib: string;
  tests: string;
  /** Comma-separated lib module basenames (verbose / JSON catalog). */
  modules?: string;
}

export interface SkillCoverageDetail {
  skill: string;
  skillPath: string;
  libModules: string[];
  testFiles: string[];
}

export const SKILL_TABLE_COLUMNS: (keyof SkillTableRow)[] = [
  "skill",
  "layer",
  "lines",
  "tokens",
  "triggers",
  "deps",
  "loaded_by",
  "contract",
  "lib",
  "tests",
];

export const SKILL_TABLE_VERBOSE_COLUMNS: (keyof SkillTableRow)[] = [
  ...SKILL_TABLE_COLUMNS,
  "modules",
];

function libModuleBasenames(paths: Array<{ path: string; exists: boolean }>): string {
  return paths
    .filter((m) => m.exists)
    .map((m) => basename(m.path))
    .join(", ");
}

/** Per-skill lib/test paths for JSON catalog and verbose tables. */
export function buildSkillCoverageDetails(rows: SkillCoverageRow[]): SkillCoverageDetail[] {
  return rows.map((row) => ({
    skill: skillShortName(row.skill),
    skillPath: row.skill,
    libModules: row.libModules.filter((m) => m.exists).map((m) => m.path),
    testFiles: row.testFiles.filter((t) => t.exists).map((t) => t.path),
  }));
}

/** Read a scalar frontmatter field from the YAML header block. */
export function readFrontmatterScalar(head: string, key: string): string {
  const match = head.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match) return "—";
  const value = match[1]?.trim() ?? "";
  if (value.startsWith("|")) return "(block)";
  return value.replace(/^"|"$/g, "");
}

/** Count list items under a frontmatter key. */
export function countFrontmatterList(head: string, key: string): number {
  const block = head.match(new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s+.+\\n)+)`, "m"));
  if (!block) return 0;
  return (block[1]?.match(/^\s+-\s+/gm) ?? []).length;
}

/** Extract YAML frontmatter (between first two `---` lines). */
export function sliceSkillFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text.slice(0, 1400);
  const end = text.indexOf("\n---", 4);
  return end > 0 ? text.slice(0, end) : text.slice(0, 1400);
}

export function skillShortName(skillRel: string): string {
  return skillRel.replace(/^skills\//, "").replace(/\/SKILL\.md$/, "");
}

/** Build table rows from a skill-coverage report plus on-disk SKILL.md headers. */
export async function buildSkillTableRows(
  repoRoot: string,
  rows: SkillCoverageRow[],
  options?: { verbose?: boolean }
): Promise<SkillTableRow[]> {
  const table: SkillTableRow[] = [];

  for (const row of rows) {
    const text = await Bun.file(join(repoRoot, row.skill)).text();
    const head = sliceSkillFrontmatter(text);
    const libOk = row.libModules.filter((m) => m.exists).length;
    const loadedBy = readFrontmatterScalar(head, "loaded_by");

    const entry: SkillTableRow = {
      skill: skillShortName(row.skill),
      layer: readFrontmatterScalar(head, "layer"),
      lines: row.lines,
      tokens: readFrontmatterScalar(head, "token_estimate"),
      triggers: countFrontmatterList(head, "trigger"),
      deps: countFrontmatterList(head, "dependencies"),
      loaded_by: truncateDisplay(loadedBy, LOADED_BY_MAX_COLS),
      contract: row.contractOk ? "✓" : "✗",
      lib: `${libOk}/${row.libModules.length}`,
      tests: row.testsOk ? "✓" : "✗",
    };
    if (options?.verbose) {
      entry.modules = truncateDisplay(libModuleBasenames(row.libModules), 48);
    }
    table.push(entry);
  }

  return table;
}

/** Format rows with Bun.inspect.table (via formatTable). */
export function formatSkillTable(rows: SkillTableRow[], verbose = false): string {
  const columns = verbose ? SKILL_TABLE_VERBOSE_COLUMNS : SKILL_TABLE_COLUMNS;
  return formatTable(rows as unknown as Record<string, unknown>[], columns as unknown as string[]);
}

/** Pass to Bun.inspect() to render a table via [customInspect]. */
export class SkillCatalog {
  constructor(readonly rows: SkillTableRow[]) {}

  [customInspect](): string {
    return formatSkillTable(this.rows);
  }
}
