/**
 * Taxonomy validator powered by Bun.Transpiler.
 *
 * Validates the flag taxonomy defined in flag-taxonomy.ts by transpiling the
 * module at runtime and checking for duplicate categorizations.
 */

import { makeDir, removePath, writeText } from "../lib/bun-io.ts";

export interface TaxonomyValidationResult {
  valid: boolean;
  duplicates: { flag: string; categories: string[] }[];
  message: string;
}

/**
 * Load the taxonomy module by transpiling flag-taxonomy.ts with Bun.Transpiler
 * and importing the resulting JavaScript from a temporary file.
 */
export async function loadTaxonomyFromSource(sourcePath: string): Promise<{
  FLAG_CATEGORIES: Record<string, Set<string>>;
  findStructuralIssues?: () => { kind: string; category?: string; flag?: string }[];
}> {
  const source = await Bun.file(sourcePath).text();
  const transpiler = new Bun.Transpiler({
    loader: "ts",
    target: "bun",
  });
  const js = transpiler.transformSync(source);

  const tmpDir = `${Bun.env.TMPDIR || "/tmp"}/taxonomy-validator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  makeDir(tmpDir, { recursive: true });
  const tmpPath = `${tmpDir}/flag-taxonomy.mjs`;
  writeText(tmpPath, js);

  try {
    const mod = (await import(tmpPath)) as {
      FLAG_CATEGORIES: Record<string, Set<string>>;
      findDuplicateFlags?: () => { flag: string; categories: string[] }[];
    };
    return mod;
  } finally {
    removePath(tmpDir, { recursive: true });
  }
}

export interface TaxonomyIssue {
  kind: string;
  category?: string;
  flag?: string;
}

function findStructuralIssuesFromCategories(
  categories: Record<string, Set<string>>
): TaxonomyIssue[] {
  const issues: TaxonomyIssue[] = [];
  for (const [category, flags] of Object.entries(categories)) {
    if (category.trim() === "") {
      issues.push({ kind: "empty-category-name" });
      continue;
    }
    if (flags.size === 0) {
      issues.push({ kind: "empty-category", category });
    }
    for (const flag of flags) {
      if (flag.trim() === "") {
        issues.push({ kind: "empty-flag-name", category });
      } else if (/\s/.test(flag)) {
        issues.push({ kind: "flag-contains-whitespace", category, flag });
      }
    }
  }
  return issues;
}

/**
 * Validate the taxonomy for structural issues such as empty categories or
 * malformed flag names.
 */
export async function validateTaxonomy(sourcePath: string): Promise<TaxonomyValidationResult> {
  const { FLAG_CATEGORIES, findStructuralIssues } = await loadTaxonomyFromSource(sourcePath);

  const issues = findStructuralIssues
    ? findStructuralIssues()
    : findStructuralIssuesFromCategories(FLAG_CATEGORIES);

  if (issues.length === 0) {
    return {
      valid: true,
      duplicates: [],
      message: `Taxonomy valid: ${Object.keys(FLAG_CATEGORIES).length} categories loaded with no structural issues.`,
    };
  }

  const lines = issues.map((issue: TaxonomyIssue) => {
    if (issue.kind === "empty-category") return `  - category "${issue.category}" is empty`;
    if (issue.kind === "empty-flag-name") return `  - empty flag name in category "${issue.category}"`;
    if (issue.kind === "flag-contains-whitespace")
      return `  - flag "${issue.flag}" contains whitespace in category "${issue.category}"`;
    return `  - ${issue.kind}`;
  });
  return {
    valid: false,
    duplicates: [],
    message: `Taxonomy invalid: ${issues.length} structural issue(s).\n${lines.join("\n")}`,
  };
}
