/**
 * error-taxonomy.ts — classify tool failures against ~/.kimi-code/error-taxonomy.yml.
 *
 * Categories are defined in YAML so agents and hooks can share a single schema.
 */

import { existsSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";

import { homeDir } from "./paths.ts";

export interface TaxonomyPattern {
  regex: string;
}

export interface TaxonomyCategory {
  id: string;
  name: string;
  description: string;
  severity: "info" | "warn" | "error";
  expected: boolean;
  patterns: TaxonomyPattern[];
  suggestion?: string;
  autoFix?: string;
  docLink?: string;
}

export interface Taxonomy {
  version: number;
  categories: TaxonomyCategory[];
}

export interface TaxonomyMatch {
  category: TaxonomyCategory;
  matchedPattern?: string;
}

export interface TaxonomySuggestion {
  categoryId: string;
  categoryName: string;
  suggestion: string;
  autoFix?: string;
  docLink?: string;
  severity: TaxonomyCategory["severity"];
}

export function taxonomyPath(home: string = homeDir()): string {
  return join(home, ".kimi-code", "error-taxonomy.yml");
}

export async function loadTaxonomy(path?: string): Promise<Taxonomy> {
  const p = path || taxonomyPath();
  if (!existsSync(p)) {
    return { version: 1, categories: [unknownCategory()] };
  }

  const text = await Bun.file(p).text();
  const parsed = yaml.load(text) as Partial<Taxonomy> | null;
  if (!parsed || typeof parsed !== "object") {
    return { version: 1, categories: [unknownCategory()] };
  }

  const categories = (parsed.categories || [])
    .filter((c): c is TaxonomyCategory => !!c && typeof c === "object" && typeof c.id === "string")
    .map((c) => ({
      ...c,
      patterns: (c.patterns || []).filter(
        (p): p is TaxonomyPattern => !!p && typeof p.regex === "string"
      ),
    }));

  return { version: parsed.version || 1, categories };
}

export function unknownCategory(): TaxonomyCategory {
  return {
    id: "unknown",
    name: "Unknown",
    description: "No known pattern matched.",
    severity: "info",
    expected: false,
    patterns: [],
  };
}

export function classifyFailure(output: string, taxonomy?: Taxonomy): TaxonomyMatch {
  const categories = taxonomy?.categories || [unknownCategory()];
  for (const category of categories) {
    for (const pattern of category.patterns) {
      try {
        const re = new RegExp(pattern.regex, "i");
        if (re.test(output)) {
          return { category, matchedPattern: pattern.regex };
        }
      } catch {
        // Invalid regex in taxonomy — skip.
      }
    }
  }
  return { category: unknownCategory() };
}

/** Return all taxonomy suggestions matching output text. */
export function getSuggestions(output: string, taxonomy?: Taxonomy): TaxonomySuggestion[] {
  const categories = taxonomy?.categories || [unknownCategory()];
  const results: TaxonomySuggestion[] = [];
  const seen = new Set<string>();

  for (const category of categories) {
    if (category.id === "unknown") continue;
    for (const pattern of category.patterns) {
      try {
        const re = new RegExp(pattern.regex, "i");
        if (re.test(output) && !seen.has(category.id)) {
          seen.add(category.id);
          const suggestion =
            category.suggestion ||
            category.description ||
            `Matched ${category.name}. See error-taxonomy.yml#${category.id}.`;
          results.push({
            categoryId: category.id,
            categoryName: category.name,
            suggestion,
            autoFix: category.autoFix,
            docLink: category.docLink,
            severity: category.severity,
          });
          break;
        }
      } catch {
        // Invalid regex — skip.
      }
    }
  }

  return results;
}

/** Classify failure and return primary suggestion if available. */
export async function classifyAndSuggest(
  output: string,
  taxonomyPathOverride?: string
): Promise<{ match: TaxonomyMatch; suggestions: TaxonomySuggestion[] }> {
  const taxonomy = await loadTaxonomy(taxonomyPathOverride);
  const match = classifyFailure(output, taxonomy);
  const suggestions = getSuggestions(output, taxonomy);
  return { match, suggestions };
}

export interface ClassifiedFailure {
  timestamp: string;
  toolName: string;
  output: string;
  categoryId: string;
  categoryName: string;
  severity: string;
  expected: boolean;
  matchedPattern?: string;
  sessionId?: string;
  suggestion?: string;
  autoFix?: string;
}

export function buildClassifiedFailure(
  toolName: string,
  output: string,
  match: TaxonomyMatch,
  extras?: { sessionId?: string }
): ClassifiedFailure {
  return {
    timestamp: new Date().toISOString(),
    toolName,
    output: output.slice(0, 2000),
    categoryId: match.category.id,
    categoryName: match.category.name,
    severity: match.category.severity,
    expected: match.category.expected,
    matchedPattern: match.matchedPattern,
    suggestion: match.category.suggestion || match.category.description,
    autoFix: match.category.autoFix,
    sessionId: extras?.sessionId,
  };
}
