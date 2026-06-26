/**
 * Taxonomy coverage analysis.
 *
 * Categorizes every flag found in completions/bun-cli.json using the taxonomy
 * from flag-taxonomy.ts and reports coverage gaps.
 */

import { FLAG_CATEGORIES, type FlagCategory } from "./flag-taxonomy.ts";
import type { CompletionData, FlagEntry } from "./completion-matrix.ts";

export interface FlagCoverage {
  flag: string;
  categories: FlagCategory[];
}

export interface CommandCoverage {
  command: string;
  flags: FlagCoverage[];
  uncategorized: string[];
}

export interface TaxonomyCoverageReport {
  schema: string;
  generatedAt: string;
  totalFlags: number;
  categorizedFlags: number;
  uncategorizedFlags: number;
  coveragePercent: number;
  byCategory: Record<FlagCategory, number>;
  globalFlags: FlagCoverage[];
  commands: CommandCoverage[];
  uncategorized: string[];
}

function categorize(flag: string): FlagCategory[] {
  const categories: FlagCategory[] = [];
  for (const [cat, flags] of Object.entries(FLAG_CATEGORIES)) {
    if (flags.has(flag)) categories.push(cat as FlagCategory);
  }
  return categories.length ? categories : ["uncategorized"];
}

function uniqueFlags(flags: FlagEntry[]): FlagCoverage[] {
  const seen = new Set<string>();
  const result: FlagCoverage[] = [];
  for (const flag of flags) {
    if (seen.has(flag.name)) continue;
    seen.add(flag.name);
    result.push({ flag: flag.name, categories: categorize(flag.name) });
  }
  return result;
}

export function buildTaxonomyCoverage(
  data: CompletionData,
  generatedAt = new Date().toISOString()
): TaxonomyCoverageReport {
  const globalFlags = uniqueFlags(data.globalFlags);
  const commands: CommandCoverage[] = [];
  const allUncategorized = new Set<string>();

  for (const flag of globalFlags) {
    if (flag.categories.length === 1 && flag.categories[0] === "uncategorized") {
      allUncategorized.add(flag.flag);
    }
  }

  for (const [name, cmd] of Object.entries(data.commands)) {
    const flags = uniqueFlags(cmd.flags);
    const uncategorized = flags
      .filter((f) => f.categories.length === 1 && f.categories[0] === "uncategorized")
      .map((f) => f.flag);
    for (const f of uncategorized) allUncategorized.add(f);
    commands.push({ command: name, flags, uncategorized });
  }

  const allFlags = [...globalFlags, ...commands.flatMap((c) => c.flags)];
  const categorizedFlags = allFlags.filter(
    (f) => !(f.categories.length === 1 && f.categories[0] === "uncategorized")
  ).length;
  const uncategorizedFlags = allUncategorized.size;
  const totalFlags = allFlags.length;

  const byCategory = {} as Record<FlagCategory, number>;
  byCategory.uncategorized = uncategorizedFlags;
  for (const cat of Object.keys(FLAG_CATEGORIES)) {
    byCategory[cat as FlagCategory] = allFlags.filter((f) => f.categories.includes(cat as FlagCategory)).length;
  }

  return {
    schema: data.version,
    generatedAt,
    totalFlags,
    categorizedFlags,
    uncategorizedFlags,
    coveragePercent: totalFlags === 0 ? 0 : Math.round((categorizedFlags / totalFlags) * 10000) / 100,
    byCategory,
    globalFlags,
    commands,
    uncategorized: Array.from(allUncategorized).sort(),
  };
}
