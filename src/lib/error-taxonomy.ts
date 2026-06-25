/**
 * error-taxonomy.ts — classify tool failures against ~/.kimi-code/error-taxonomy.yml.
 *
 * Categories are defined in YAML so agents and hooks can share a single schema.
 */

import { pathExists } from "./bun-io.ts";
import { join } from "path";
import yaml from "js-yaml";

import { homeDir } from "./paths.ts";
import { sha256String } from "./hash.ts";

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
  /** bunfig `[define]` keys that influence this failure category. */
  boundConstants?: string[];
  /** @deprecated Use boundConstants — still accepted for legacy taxonomy YAML. */
  relatedConstants?: string[];
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

function repoTaxonomyPath(): string {
  return join(import.meta.dir, "..", "..", "error-taxonomy.yml");
}

/** Preferred entry point — repo taxonomy under NODE_ENV=test, desktop runtime otherwise. */
export function resolveTaxonomyPath(override?: string): string {
  if (override) return override;

  if (Bun.env.NODE_ENV === "test") {
    const repo = repoTaxonomyPath();
    if (pathExists(repo)) return repo;
    process.stderr.write(
      `⚠ resolveTaxonomyPath: repo taxonomy missing at ${repo}; falling back to ${taxonomyPath()}\n`
    );
  }

  return taxonomyPath();
}

export async function loadTaxonomy(path?: string): Promise<Taxonomy> {
  const p = resolveTaxonomyPath(path);
  if (!pathExists(p)) {
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

export const FAILURE_SCHEMA_VERSION = 1;

export interface ClassifiedFailure {
  schemaVersion: number;
  timestamp: string;
  toolName: string;
  output: string;
  /** Stable id for clustering and suggest lookups. */
  errorId?: string;
  /** Assigned by semantic clustering; optional for backward compatibility. */
  clusterId?: string;
  /** Canonical taxonomy category id (preferred). */
  taxonomyId: string;
  /** @deprecated Use taxonomyId — kept for one release for JSONL readers. */
  categoryId: string;
  categoryName: string;
  severity: string;
  expected: boolean;
  matchedPattern?: string;
  sessionId?: string;
  traceId?: string;
  parentTraceId?: string;
  childTraceIds?: string[];
  suggestion?: string;
  autoFix?: string;
  /** Base64-encoded Float32 embedding (384-dim). */
  embedding?: string;
  context?: {
    stack?: string;
    inputs?: Record<string, unknown>;
    environment?: Record<string, string>;
  };
}

export function formatFailureOutput(error: unknown, fallback?: unknown): string {
  for (const value of [error, fallback]) {
    const formatted = formatFailureValue(value);
    if (formatted) return formatted.slice(0, 4000);
  }
  return "";
}

/** True when a legacy hook stored the pre-P0 Object#toString placeholder. */
export function isOpaqueFailureOutput(output: string): boolean {
  return output.trim() === "[object Object]";
}

/** Prefer stored output; fall back to context.stack when output is opaque or empty. */
export function reconstructFailureOutput(record: {
  output?: string;
  context?: { stack?: string; inputs?: Record<string, unknown> };
}): string {
  const output = (record.output ?? "").trim();
  if (output && !isOpaqueFailureOutput(output)) return output;
  const stack = record.context?.stack?.trim();
  if (stack) return stack;
  return output;
}

export function buildClassifiedFailure(
  toolName: string,
  output: string,
  match: TaxonomyMatch,
  extras?: {
    sessionId?: string;
    traceId?: string;
    parentTraceId?: string;
    childTraceIds?: string[];
    context?: {
      stack?: string;
      inputs?: Record<string, unknown>;
      environment?: Record<string, string>;
    };
  }
): ClassifiedFailure {
  const taxonomyId = match.category.id;
  const timestamp = new Date().toISOString();
  const record: ClassifiedFailure = {
    schemaVersion: FAILURE_SCHEMA_VERSION,
    timestamp,
    toolName,
    output: output.slice(0, 2000),
    taxonomyId,
    categoryId: taxonomyId,
    categoryName: match.category.name,
    severity: match.category.severity,
    expected: match.category.expected,
    matchedPattern: match.matchedPattern,
    suggestion: match.category.suggestion || match.category.description,
    autoFix: match.category.autoFix,
    sessionId: extras?.sessionId,
    traceId: extras?.traceId,
    parentTraceId: extras?.parentTraceId,
    childTraceIds: extras?.childTraceIds,
    context: extras?.context,
  };
  record.errorId = `error-${sha256String(`${timestamp}|${toolName}|${output.slice(0, 512)}`).slice(0, 12)}`;
  return record;
}

/** Prefer human-readable shell / hook fields before generic serialization. */
const ERROR_SHAPE_STRING_KEYS = ["message", "error", "stderr", "stdout", "reason"] as const;

function failureJsonReplacer(_key: string, v: unknown): unknown {
  if (typeof v === "bigint") return `${v}n`;
  if (typeof v === "function") return `function ${v.name || "anonymous"}`;
  if (typeof v === "symbol") return v.toString();
  return v;
}

function formatFailureValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (value instanceof Error) return (value.stack ?? value.message).trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return `function ${value.name || "anonymous"}`;

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ERROR_SHAPE_STRING_KEYS) {
      const field = record[key];
      if (typeof field === "string" && field.trim()) return field.trim();
    }
    for (const key of ["exitCode", "signal"] as const) {
      const field = record[key];
      if (typeof field === "number" || typeof field === "boolean") return `${key}=${String(field)}`;
    }
    try {
      return JSON.stringify(value, failureJsonReplacer, 2);
    } catch {
      return Bun.inspect(value);
    }
  }

  return Object.prototype.toString.call(value);
}
