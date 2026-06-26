/**
 * Taxonomy coverage analysis.
 *
 * Categorizes every flag found in completions/bun-cli.json using the taxonomy
 * from flag-taxonomy.ts and reports coverage gaps.
 */

import { classifyFlag, classifyFlagForCommand, FLAG_CATEGORIES, type FlagCategory } from "./flag-taxonomy.ts";
import type { CompletionData, FlagEntry } from "./completion-matrix.ts";

const ALL_CATEGORIES = Object.keys(FLAG_CATEGORIES) as FlagCategory[];

export interface FlagCoverage {
  flag: string;
  /** Global (name-based) categories. */
  categories: FlagCategory[];
  /** Command-local categories when they differ from global; omitted otherwise. */
  commandCategories?: FlagCategory[];
}

export interface CommandCoverage {
  command: string;
  flags: FlagCoverage[];
  /** Flags that are uncategorized under command-local semantics. */
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
  /** Category counts using command-local categories. */
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
  /** Per-category occurrence counts using global categories. */
  byCategory: Record<FlagCategory, number>;
  /** Per-category distribution with unique counts. */
  categoryDistribution: Record<FlagCategory | "uncategorized", CategoryDistribution>;
  /** Per-command summary statistics using command-local categories. */
  commandBreakdown: CommandBreakdown[];
  /** Flags that appear under more than one global category. */
  multiCategoryFlags: MultiCategoryEntry[];
  /** Most widely shared flags sorted by occurrence count. */
  occurrenceHistogram: OccurrenceEntry[];
  globalFlags: FlagCoverage[];
  commands: CommandCoverage[];
  uncategorized: string[];
}

function uniqueFlags(flags: FlagEntry[]): FlagCoverage[] {
  const seen = new Set<string>();
  const result: FlagCoverage[] = [];
  for (const flag of flags) {
    if (seen.has(flag.name)) continue;
    seen.add(flag.name);
    result.push({ flag: flag.name, categories: classifyFlag(flag.name) });
  }
  return result;
}

function isUncategorized(categories: FlagCategory[]): boolean {
  return categories.length === 1 && categories[0] === "uncategorized";
}

function countByCategory(flags: FlagCoverage[]): Record<FlagCategory, number> {
  const counts = { uncategorized: 0 } as Record<FlagCategory, number>;
  for (const cat of ALL_CATEGORIES) counts[cat] = 0;
  for (const f of flags) {
    for (const cat of f.categories) {
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
  }
  return counts;
}

function buildOccurrenceMap(data: CompletionData): Map<string, OccurrenceEntry> {
  const map = new Map<string, OccurrenceEntry>();
  const record = (flag: string, command: string) => {
    const entry = map.get(flag) ?? { flag, occurrences: 0, commands: [] };
    entry.occurrences += 1;
    if (!entry.commands.includes(command)) entry.commands.push(command);
    map.set(flag, entry);
  };
  for (const flag of data.globalFlags) record(flag.name, "(global)");
  for (const [name, cmd] of Object.entries(data.commands)) {
    for (const flag of cmd.flags) record(flag.name, name);
  }
  return map;
}

export function buildTaxonomyCoverage(
  data: CompletionData,
  generatedAt = new Date().toISOString()
): TaxonomyCoverageReport {
  const occurrenceMap = buildOccurrenceMap(data);
  const globalFlags = uniqueFlags(data.globalFlags);
  const commands: CommandCoverage[] = [];
  const allUncategorized = new Set<string>();

  for (const flag of globalFlags) {
    if (isUncategorized(flag.categories)) allUncategorized.add(flag.flag);
  }

  for (const [name, cmd] of Object.entries(data.commands)) {
    const flags = uniqueFlags(cmd.flags);
    const commandFlags: FlagCoverage[] = flags.map((f) => {
      const local = classifyFlagForCommand(f.flag, name);
      return isUncategorized(local) || arraysEqual(local, f.categories)
        ? f
        : { ...f, commandCategories: local };
    });
    const uncategorized = commandFlags.filter((f) => isUncategorized(f.commandCategories ?? f.categories)).map((f) => f.flag);
    for (const f of uncategorized) allUncategorized.add(f);
    commands.push({ command: name, flags: commandFlags, uncategorized });
  }

  const allFlags = [...globalFlags, ...commands.flatMap((c) => c.flags)];
  const categorizedFlags = allFlags.filter((f) => !isUncategorized(f.categories)).length;
  const uncategorizedFlags = allUncategorized.size;
  const totalFlags = allFlags.length;

  const byCategory = { uncategorized: uncategorizedFlags } as Record<FlagCategory, number>;
  for (const cat of ALL_CATEGORIES) {
    byCategory[cat] = allFlags.filter((f) => f.categories.includes(cat)).length;
  }

  const uniqueFlagMap = new Map<string, FlagCoverage>();
  for (const f of allFlags) {
    if (!uniqueFlagMap.has(f.flag)) uniqueFlagMap.set(f.flag, f);
  }
  const uniqueFlagList = Array.from(uniqueFlagMap.values());
  const uniqueFlagsCount = uniqueFlagList.length;
  const uniqueCategorizedList = uniqueFlagList.filter((f) => !isUncategorized(f.categories));
  const uniqueCategorizedFlags = uniqueCategorizedList.length;
  const uniqueUncategorizedFlags = uniqueFlagsCount - uniqueCategorizedFlags;
  const uniqueCoveragePercent =
    uniqueFlagsCount === 0 ? 0 : Math.round((uniqueCategorizedFlags / uniqueFlagsCount) * 10000) / 100;

  const categoryDistribution = {} as Record<FlagCategory | "uncategorized", CategoryDistribution>;
  const distributionFor = (total: number, unique: number): CategoryDistribution => ({
    total,
    unique,
    uniquePercent: uniqueFlagsCount === 0 ? 0 : Math.round((unique / uniqueFlagsCount) * 10000) / 100,
  });
  categoryDistribution.uncategorized = distributionFor(uncategorizedFlags, uniqueUncategorizedFlags);
  for (const cat of ALL_CATEGORIES) {
    const uniqueInCat = uniqueFlagList.filter((f) => f.categories.includes(cat)).length;
    categoryDistribution[cat] = distributionFor(byCategory[cat], uniqueInCat);
  }

  const commandBreakdown: CommandBreakdown[] = commands.map((cmd) => {
    const localFlags: FlagCoverage[] = cmd.flags.map((f) => ({
      ...f,
      categories: f.commandCategories ?? f.categories,
    }));
    const catCounts = countByCategory(localFlags);
    const uncategorizedCount = cmd.uncategorized.length;
    return {
      command: cmd.command,
      totalFlags: localFlags.length,
      categorizedFlags: localFlags.length - uncategorizedCount,
      uncategorizedFlags: uncategorizedCount,
      coveragePercent:
        localFlags.length === 0
          ? 0
          : Math.round(((localFlags.length - uncategorizedCount) / localFlags.length) * 10000) / 100,
      byCategory: catCounts,
    };
  });

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

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
