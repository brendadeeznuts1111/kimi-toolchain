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

export interface CategoryDistribution {
  /** Total flag occurrences in this category across all commands + global. */
  total: number;
  /** Unique flag names in this category. */
  unique: number;
  /** Percentage of all unique flags that fall into this category. */
  uniquePercent: number;
}

export interface CommandBreakdown {
  command: string;
  totalFlags: number;
  categorizedFlags: number;
  uncategorizedFlags: number;
  coveragePercent: number;
  byCategory: Record<FlagCategory, number>;
}

export interface OccurrenceEntry {
  flag: string;
  occurrences: number;
  commands: string[];
}

export interface MultiCategoryEntry {
  flag: string;
  categories: FlagCategory[];
  occurrences: number;
  commands: string[];
}

export interface TaxonomyCoverageReport {
  schema: string;
  generatedAt: string;
  /** Total flag occurrences across global flags + every command. */
  totalFlags: number;
  /** Categorized flag occurrences. */
  categorizedFlags: number;
  /** Uncategorized flag occurrences. */
  uncategorizedFlags: number;
  coveragePercent: number;
  /** Unique flag names across global flags + every command. */
  uniqueFlags: number;
  /** Unique categorized flag names. */
  uniqueCategorizedFlags: number;
  /** Unique uncategorized flag names. */
  uniqueUncategorizedFlags: number;
  uniqueCoveragePercent: number;
  /** Per-category occurrence and unique counts. */
  byCategory: Record<FlagCategory, number>;
  categoryDistribution: Record<FlagCategory | "uncategorized", CategoryDistribution>;
  /** Per-command summary statistics. */
  commandBreakdown: CommandBreakdown[];
  /** Flags that appear under more than one category. */
  multiCategoryFlags: MultiCategoryEntry[];
  /** Most widely shared flags sorted by occurrence count. */
  occurrenceHistogram: OccurrenceEntry[];
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

function countByCategory(flags: FlagCoverage[]): Record<FlagCategory, number> {
  const counts = {} as Record<FlagCategory, number>;
  for (const cat of Object.keys(FLAG_CATEGORIES)) {
    counts[cat as FlagCategory] = flags.filter((f) => f.categories.includes(cat as FlagCategory)).length;
  }
  return counts;
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

  // Unique flag analytics
  const uniqueFlagMap = new Map<string, FlagCoverage>();
  for (const f of allFlags) {
    if (!uniqueFlagMap.has(f.flag)) uniqueFlagMap.set(f.flag, f);
  }
  const uniqueFlagList = Array.from(uniqueFlagMap.values());
  const uniqueFlagsCount = uniqueFlagList.length;
  const uniqueCategorizedList = uniqueFlagList.filter(
    (f) => !(f.categories.length === 1 && f.categories[0] === "uncategorized")
  );
  const uniqueCategorizedFlags = uniqueCategorizedList.length;
  const uniqueUncategorizedFlags = uniqueFlagsCount - uniqueCategorizedFlags;
  const uniqueCoveragePercent =
    uniqueFlagsCount === 0 ? 0 : Math.round((uniqueCategorizedFlags / uniqueFlagsCount) * 10000) / 100;

  const categoryDistribution = {} as Record<FlagCategory | "uncategorized", CategoryDistribution>;
  categoryDistribution.uncategorized = {
    total: uncategorizedFlags,
    unique: uniqueUncategorizedFlags,
    uniquePercent:
      uniqueFlagsCount === 0 ? 0 : Math.round((uniqueUncategorizedFlags / uniqueFlagsCount) * 10000) / 100,
  };
  for (const cat of Object.keys(FLAG_CATEGORIES)) {
    const catKey = cat as FlagCategory;
    const uniqueInCat = uniqueFlagList.filter((f) => f.categories.includes(catKey)).length;
    categoryDistribution[catKey] = {
      total: byCategory[catKey],
      unique: uniqueInCat,
      uniquePercent: uniqueFlagsCount === 0 ? 0 : Math.round((uniqueInCat / uniqueFlagsCount) * 10000) / 100,
    };
  }

  // Per-command breakdown
  const commandBreakdown: CommandBreakdown[] = commands.map((cmd) => {
    const catCounts = countByCategory(cmd.flags);
    catCounts.uncategorized = cmd.uncategorized.length;
    return {
      command: cmd.command,
      totalFlags: cmd.flags.length,
      categorizedFlags: cmd.flags.length - cmd.uncategorized.length,
      uncategorizedFlags: cmd.uncategorized.length,
      coveragePercent:
        cmd.flags.length === 0 ? 0 : Math.round(((cmd.flags.length - cmd.uncategorized.length) / cmd.flags.length) * 10000) / 100,
      byCategory: catCounts,
    };
  });

  // Occurrence histogram
  const occurrenceMap = new Map<string, { flag: string; occurrences: number; commands: string[] }>();
  const recordOccurrence = (flag: string, command: string) => {
    const entry = occurrenceMap.get(flag) ?? { flag, occurrences: 0, commands: [] };
    entry.occurrences += 1;
    if (!entry.commands.includes(command)) entry.commands.push(command);
    occurrenceMap.set(flag, entry);
  };

  for (const flag of data.globalFlags) recordOccurrence(flag.name, "(global)");
  for (const [name, cmd] of Object.entries(data.commands)) {
    for (const flag of cmd.flags) recordOccurrence(flag.name, name);
  }

  const occurrenceHistogram = Array.from(occurrenceMap.values())
    .filter((e) => e.occurrences > 1)
    .sort((a, b) => b.occurrences - a.occurrences || a.flag.localeCompare(b.flag));

  const multiCategoryFlags: MultiCategoryEntry[] = uniqueFlagList
    .filter((f) => f.categories.length > 1)
    .map((f) => {
      const entry = occurrenceMap.get(f.flag)!;
      return {
        flag: f.flag,
        categories: f.categories,
        occurrences: entry.occurrences,
        commands: entry.commands,
      };
    })
    .sort((a, b) => b.occurrences - a.occurrences || a.flag.localeCompare(b.flag));

  return {
    schema: data.version,
    generatedAt,
    totalFlags,
    categorizedFlags,
    uncategorizedFlags,
    coveragePercent: totalFlags === 0 ? 0 : Math.round((categorizedFlags / totalFlags) * 10000) / 100,
    uniqueFlags: uniqueFlagsCount,
    uniqueCategorizedFlags,
    uniqueUncategorizedFlags,
    uniqueCoveragePercent,
    byCategory,
    categoryDistribution,
    commandBreakdown,
    multiCategoryFlags,
    occurrenceHistogram,
    globalFlags,
    commands,
    uncategorized: Array.from(allUncategorized).sort(),
  };
}
