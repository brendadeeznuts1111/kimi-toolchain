/**
 * Deep discovery for bunfig [define] constants — values, ranges, validation,
 * usage sites, taxonomy bindings, parity, golden drift, and manifest health.
 */

import { pathExists } from "./bun-io.ts";
import { join } from "path";
import {
  buildManifestDomains,
  evaluateParityShared,
  generateConstantsManifest,
  loadParityConfig,
  loadRepoDefineMap,
  manifestNeedsRefresh,
  parseBunfigDefines,
  parseBuildConstantsTypes,
  parseConstantRange,
  readConstantsManifest,
  TUNING_SET_VERSION_KEY,
  type ManifestConstant,
  type ParitySharedEntry,
} from "./build-constants-registry.ts";
import { diffAgainstGolden, loadConstantsGolden } from "./constants-heal.ts";
import {
  loadConstantSchemas,
  validateConstant,
  type ConstantValidationIssue,
} from "./constants-registry.ts";
import { readDecisions } from "./decision-ledger.ts";
import { loadTaxonomy } from "./error-taxonomy.ts";
import { failureLedgerPath } from "./paths.ts";
import {
  findLastConstantModification,
  formatAgeShort,
  loadFailureCountsByTaxonomy,
} from "./taxonomy-constants.ts";

export type { ConstantRange } from "./build-constants-registry.ts";
export { formatConstantRange, parseConstantRange } from "./build-constants-registry.ts";

export interface ConstantSources {
  bunfigLine?: number;
  typesLine?: number;
  rawValue?: string;
}

export interface ConstantUsageBreakdown {
  src: string[];
  test: string[];
  scripts: string[];
}

export interface TaxonomyBinding {
  id: string;
  name: string;
  severity: string;
  failureCount: number;
}

export interface SeeReference {
  ref: string;
  path: string;
  exists: boolean;
}

export interface ConstantModification {
  decisionId: string;
  ageMs: number;
  ageLabel: string;
}

export interface ConstantParityLink {
  id: string;
  aligned: boolean;
  drift?: string;
  repos: ParitySharedEntry["repos"];
}

export interface DiscoveredConstant {
  key: string;
  domain: string;
  type: string;
  typeExpr?: string;
  value: string | number | boolean;
  range: ReturnType<typeof parseConstantRange>;
  restrictions?: string;
  description?: string;
  see?: string[];
  enumValues?: string[];
  sources: ConstantSources;
  valid: boolean;
  validationIssues: string[];
  usages: string[];
  usageBreakdown: ConstantUsageBreakdown;
  orphan: boolean;
  annotationsComplete: boolean;
  taxonomy: TaxonomyBinding[];
  lastModified?: ConstantModification;
  parity?: ConstantParityLink;
  goldenValue?: string | number | boolean;
  goldenDrift: boolean;
  seeResolved: SeeReference[];
  literalDuplicateHits: string[];
  suggestionMentions: string[];
}

export interface DiscoverDomainSummary {
  domain: string;
  constantCount: number;
  validCount: number;
  orphanCount: number;
  taxonomyBoundCount: number;
}

export interface DiscoverAlignmentReport {
  definesWithoutTypes: string[];
  typesWithoutDefines: string[];
}

export interface DiscoverGoldenDiff {
  missingKeys: string[];
  drifted: Array<{
    key: string;
    expected: string | number | boolean;
    actual: string | number | boolean;
  }>;
}

export interface DiscoverConstantsOptions {
  includeUsages?: boolean;
  usageRoots?: readonly string[];
}

export interface DiscoverConstantsReport {
  tuningSetVersion: string;
  constantCount: number;
  validCount: number;
  invalidCount: number;
  orphanCount: number;
  annotationGapCount: number;
  goldenDriftCount: number;
  manifestStale: boolean;
  healthScore: number;
  domains: DiscoverDomainSummary[];
  alignment: DiscoverAlignmentReport;
  goldenDiff?: DiscoverGoldenDiff;
  constants: DiscoveredConstant[];
}

const DEFAULT_USAGE_ROOTS = ["src", "test", "scripts"] as const;
const USAGE_SKIP = ["discover-constants", "build-constants-registry", "constants-manifest.json"];

const LITERAL_DUPLICATE_CHECKS: Array<{ key: string; pattern: RegExp }> = [
  { key: "KIMI_ERROR_EMBEDDING_DIM", pattern: /export const EMBEDDING_DIM\s*=\s*384\b/ },
  { key: "KIMI_DECISION_SCORE_WINDOW_DAYS", pattern: /const HOLD_DAYS\s*=\s*7\b/ },
  {
    key: "KIMI_ERROR_CLUSTER_SIMILARITY_THRESHOLD",
    pattern: /const DEFAULT_CLUSTER_THRESHOLD\s*=\s*0\.55\b/,
  },
  {
    key: "KIMI_CONTRACT_OBSERVATIONS_PATH",
    pattern: /"\.kimi\/var\/contract-observations\.ndjson"/,
  },
];

function effectiveRange(
  restrictions: string | undefined,
  type: string,
  enumValues?: string[]
): ReturnType<typeof parseConstantRange> {
  const parsed = parseConstantRange(restrictions, type);
  if (parsed.kind === "unbounded" && enumValues && enumValues.length > 0) {
    return { kind: "enum", values: enumValues, description: restrictions };
  }
  return parsed;
}

function parityByKey(shared: ParitySharedEntry[]): Map<string, ConstantParityLink> {
  const map = new Map<string, ConstantParityLink>();
  for (const entry of shared) {
    for (const mapping of Object.values(entry.repos)) {
      map.set(mapping.key, {
        id: entry.id,
        aligned: entry.aligned,
        drift: entry.drift,
        repos: entry.repos,
      });
    }
  }
  return map;
}

function splitUsages(usages: readonly string[]): ConstantUsageBreakdown {
  const breakdown: ConstantUsageBreakdown = { src: [], test: [], scripts: [] };
  for (const usage of usages) {
    if (usage.startsWith("src/")) breakdown.src.push(usage);
    else if (usage.startsWith("test/")) breakdown.test.push(usage);
    else if (usage.startsWith("scripts/")) breakdown.scripts.push(usage);
  }
  return breakdown;
}

function resolveSeeReferences(projectRoot: string, refs: string[] | undefined): SeeReference[] {
  if (!refs || refs.length === 0) return [];
  return refs.map((ref) => {
    const path = ref.split(/\s+/)[0] ?? ref;
    const fullPath = join(projectRoot, path);
    return { ref, path, exists: pathExists(fullPath) };
  });
}

async function buildTaxonomyBindings(projectRoot: string): Promise<Map<string, TaxonomyBinding[]>> {
  const taxonomyPath = join(projectRoot, "error-taxonomy.yml");
  if (!pathExists(taxonomyPath)) return new Map();

  const taxonomy = await loadTaxonomy(taxonomyPath);
  const failureCounts = await loadFailureCountsByTaxonomy(failureLedgerPath());
  const map = new Map<string, TaxonomyBinding[]>();

  for (const category of taxonomy.categories) {
    for (const key of category.boundConstants ?? category.relatedConstants ?? []) {
      const bindings = map.get(key) ?? [];
      bindings.push({
        id: category.id,
        name: category.name,
        severity: category.severity,
        failureCount: failureCounts.get(category.id) ?? 0,
      });
      map.set(key, bindings);
    }
  }

  return map;
}

async function buildSuggestionMentions(projectRoot: string): Promise<Map<string, string[]>> {
  const taxonomyPath = join(projectRoot, "error-taxonomy.yml");
  if (!pathExists(taxonomyPath)) return new Map();

  const taxonomy = await loadTaxonomy(taxonomyPath);
  const map = new Map<string, string[]>();

  for (const category of taxonomy.categories) {
    const text = `${category.suggestion ?? ""} ${category.autoFix ?? ""}`;
    for (const match of text.matchAll(/KIMI_[A-Z0-9_]+/g)) {
      const key = match[0]!;
      const existing = map.get(key) ?? [];
      if (!existing.includes(category.id)) existing.push(category.id);
      map.set(key, existing);
    }
  }

  return map;
}

export interface DiscoverConstantsFilters {
  domain?: string;
  key?: string;
  orphansOnly?: boolean;
}

export function filterConstantsReport(
  report: DiscoverConstantsReport,
  filters: DiscoverConstantsFilters
): DiscoverConstantsReport {
  let constants = report.constants;
  if (filters.domain) constants = constants.filter((entry) => entry.domain === filters.domain);
  if (filters.key) constants = constants.filter((entry) => entry.key === filters.key);
  if (filters.orphansOnly) constants = constants.filter((entry) => entry.orphan);

  const domains = [...new Set(constants.map((entry) => entry.domain))].sort().map((domain) => {
    const entries = constants.filter((entry) => entry.domain === domain);
    return {
      domain,
      constantCount: entries.length,
      validCount: entries.filter((entry) => entry.valid).length,
      orphanCount: entries.filter((entry) => entry.orphan).length,
      taxonomyBoundCount: entries.filter((entry) => entry.taxonomy.length > 0).length,
    };
  });

  return {
    ...report,
    constants,
    domains,
    constantCount: constants.length,
    validCount: constants.filter((entry) => entry.valid).length,
    invalidCount: constants.filter((entry) => !entry.valid).length,
    orphanCount: constants.filter((entry) => entry.orphan).length,
    annotationGapCount: constants.filter((entry) => !entry.annotationsComplete).length,
    goldenDriftCount: constants.filter((entry) => entry.goldenDrift).length,
    healthScore: computeConstantsHealthScore({
      constantCount: constants.length,
      invalidCount: constants.filter((entry) => !entry.valid).length,
      orphanCount: constants.filter((entry) => entry.orphan).length,
      annotationGapCount: constants.filter((entry) => !entry.annotationsComplete).length,
      goldenDriftCount: constants.filter((entry) => entry.goldenDrift).length,
      manifestStale: report.manifestStale,
    }),
  };
}

export function computeConstantsHealthScore(report: {
  constantCount: number;
  invalidCount: number;
  orphanCount: number;
  annotationGapCount: number;
  goldenDriftCount: number;
  manifestStale: boolean;
}): number {
  let score = 100;
  score -= report.invalidCount * 8;
  score -= report.orphanCount * 2;
  score -= report.annotationGapCount * 1;
  score -= report.goldenDriftCount * 3;
  if (report.manifestStale) score -= 5;
  return Math.max(0, Math.min(100, score));
}

async function scanConstantUsages(
  projectRoot: string,
  keys: readonly string[],
  roots: readonly string[]
): Promise<Map<string, string[]>> {
  const usage = new Map(keys.map((key) => [key, [] as string[]]));
  const glob = new Bun.Glob("**/*.{ts,tsx}");

  for (const root of roots) {
    const base = join(projectRoot, root);
    for await (const rel of glob.scan({ cwd: base, onlyFiles: true })) {
      if (USAGE_SKIP.some((pattern) => rel.includes(pattern))) continue;
      const text = await Bun.file(join(base, rel)).text();
      for (const key of keys) {
        if (text.includes(key)) usage.get(key)!.push(`${root}/${rel}`);
      }
    }
  }

  for (const [key, files] of usage) {
    usage.set(key, [...new Set(files)].sort());
  }
  return usage;
}

async function scanLiteralDuplicatesAsync(projectRoot: string): Promise<Map<string, string[]>> {
  const hits = new Map<string, string[]>();
  const srcRoot = join(projectRoot, "src");
  const glob = new Bun.Glob("**/*.{ts,tsx}");

  for await (const rel of glob.scan({ cwd: srcRoot, onlyFiles: true })) {
    const text = await Bun.file(join(srcRoot, rel)).text();
    const lines = text.split("\n");
    for (const check of LITERAL_DUPLICATE_CHECKS) {
      if (text.includes(check.key)) continue;
      for (let i = 0; i < lines.length; i++) {
        if (check.pattern.test(lines[i]!)) {
          const existing = hits.get(check.key) ?? [];
          existing.push(`src/${rel}:${i + 1}`);
          hits.set(check.key, existing);
        }
      }
    }
  }

  return hits;
}

function collectValidationIssues(
  value: string | number | boolean,
  schemaIssue: ConstantValidationIssue | null,
  range: ReturnType<typeof parseConstantRange>
): string[] {
  const issues: string[] = [];
  if (schemaIssue) issues.push(schemaIssue.reason);

  if (range.kind === "closed" && typeof value === "number") {
    if (value < range.min! || value > range.max!) {
      issues.push(`expected [${range.min}, ${range.max}]`);
    }
  } else if (range.kind === "min" && typeof value === "number") {
    const description = range.description ?? "";
    if (/positive integer/i.test(description) && !Number.isInteger(value)) {
      issues.push("expected positive integer");
    } else if (/non-negative integer/i.test(description) && !Number.isInteger(value)) {
      issues.push("expected non-negative integer");
    } else if (value < range.min!) {
      issues.push(`expected >= ${range.min}`);
    }
  } else if (range.kind === "exact" && value !== (range.min ?? 0)) {
    issues.push(`expected ${range.min ?? 0}`);
  } else if (
    (range.kind === "enum" || range.kind === "boolean") &&
    range.values &&
    !range.values.includes(String(value))
  ) {
    issues.push(`expected one of ${range.values.join(", ")}`);
  }

  return [...new Set(issues)];
}

function buildDomainSummaries(constants: DiscoveredConstant[]): DiscoverDomainSummary[] {
  const byDomain = new Map<string, DiscoverDomainSummary>();

  for (const entry of constants) {
    const summary = byDomain.get(entry.domain) ?? {
      domain: entry.domain,
      constantCount: 0,
      validCount: 0,
      orphanCount: 0,
      taxonomyBoundCount: 0,
    };
    summary.constantCount += 1;
    if (entry.valid) summary.validCount += 1;
    if (entry.orphan) summary.orphanCount += 1;
    if (entry.taxonomy.length > 0) summary.taxonomyBoundCount += 1;
    byDomain.set(entry.domain, summary);
  }

  return [...byDomain.values()].sort((left, right) => left.domain.localeCompare(right.domain));
}

function buildAlignmentReport(
  defines: ReturnType<typeof parseBunfigDefines>,
  types: ReturnType<typeof parseBuildConstantsTypes>
): DiscoverAlignmentReport {
  const defineKeys = new Set(defines.map((entry) => entry.key));
  const typeKeys = new Set(types.keys());

  return {
    definesWithoutTypes: [...defineKeys].filter((key) => !typeKeys.has(key)).sort(),
    typesWithoutDefines: [...typeKeys].filter((key) => !defineKeys.has(key)).sort(),
  };
}

function toDiscoveredConstant(input: {
  key: string;
  domain: string;
  constant: ManifestConstant;
  typeEntry?: ReturnType<typeof parseBuildConstantsTypes> extends Map<string, infer V> ? V : never;
  defineLine?: number;
  rawValue?: string;
  usages: string[];
  taxonomy: TaxonomyBinding[];
  parity?: ConstantParityLink;
  goldenValue?: string | number | boolean;
  schemaIssue: ConstantValidationIssue | null;
  lastModified?: ConstantModification;
  seeResolved: SeeReference[];
  literalDuplicateHits: string[];
  suggestionMentions: string[];
}): DiscoveredConstant {
  const enumValues = input.typeEntry?.enumValues;
  const range = effectiveRange(input.constant.restrictions, input.constant.type, enumValues);
  const validationIssues = collectValidationIssues(
    input.constant.default,
    input.schemaIssue,
    range
  );
  const usageBreakdown = splitUsages(input.usages);
  const description = input.constant.description;
  const restrictions = input.constant.restrictions;
  const see = input.constant.see;

  return {
    key: input.key,
    domain: input.domain,
    type: input.constant.type,
    typeExpr: input.typeEntry?.typeExpr,
    value: input.constant.default,
    range,
    restrictions,
    description,
    see,
    enumValues,
    sources: {
      bunfigLine: input.defineLine,
      typesLine: input.typeEntry?.line,
      rawValue: input.rawValue,
    },
    valid: validationIssues.length === 0,
    validationIssues,
    usages: input.usages,
    usageBreakdown,
    orphan: usageBreakdown.src.length === 0,
    annotationsComplete: Boolean(description && restrictions && (see?.length ?? 0) > 0),
    taxonomy: input.taxonomy,
    lastModified: input.lastModified,
    parity: input.parity,
    goldenValue: input.goldenValue,
    goldenDrift: input.goldenValue !== undefined && input.goldenValue !== input.constant.default,
    seeResolved: input.seeResolved,
    literalDuplicateHits: input.literalDuplicateHits,
    suggestionMentions: input.suggestionMentions,
  };
}

export async function discoverConstants(
  projectRoot: string,
  options: DiscoverConstantsOptions = {}
): Promise<DiscoverConstantsReport> {
  const bunfigPath = join(projectRoot, "bunfig.toml");
  const typesPath = join(projectRoot, "types/build-constants.d.ts");
  const bunfigText = await Bun.file(bunfigPath).text();
  const typesText = await Bun.file(typesPath).text();

  const defines = parseBunfigDefines(bunfigText);
  const types = parseBuildConstantsTypes(typesText);
  const domains = buildManifestDomains(defines, types);
  const defineByKey = new Map(defines.map((entry) => [entry.key, entry]));
  const schemas = await loadConstantSchemas(projectRoot);
  const taxonomyBindings = await buildTaxonomyBindings(projectRoot);
  const suggestionMentions = await buildSuggestionMentions(projectRoot);
  const golden = await loadConstantsGolden(projectRoot);
  const decisions = await readDecisions(projectRoot);
  const literalDuplicates = await scanLiteralDuplicatesAsync(projectRoot);

  const generatedManifest = await generateConstantsManifest(projectRoot);
  const existingManifest = await readConstantsManifest(projectRoot);
  const manifestStale = manifestNeedsRefresh(generatedManifest, existingManifest);

  let goldenDiff: DiscoverGoldenDiff | undefined;
  if (golden) {
    const current = await loadRepoDefineMap(projectRoot);
    const diff = diffAgainstGolden(current, golden);
    goldenDiff = {
      missingKeys: diff.missingKeys,
      drifted: diff.invalidKeys.map((entry) => ({
        key: entry.key,
        expected: entry.expected,
        actual: entry.actual,
      })),
    };
  }

  let parityLinks = new Map<string, ConstantParityLink>();
  const parityConfig = await loadParityConfig(projectRoot);
  if (parityConfig) {
    parityLinks = parityByKey(await evaluateParityShared(projectRoot, parityConfig));
  }

  const keys = defines.map((entry) => entry.key);
  const usageRoots = options.usageRoots ?? DEFAULT_USAGE_ROOTS;
  const usages =
    options.includeUsages === false
      ? new Map(keys.map((key) => [key, [] as string[]]))
      : await scanConstantUsages(projectRoot, keys, usageRoots);

  const constants: DiscoveredConstant[] = [];

  for (const [domain, domainConstants] of Object.entries(domains)) {
    for (const [key, constant] of Object.entries(domainConstants)) {
      const define = defineByKey.get(key);
      const typeEntry = types.get(key);
      const schema = schemas.get(key);
      const see = typeEntry?.see ?? constant.see;
      const lastMod = findLastConstantModification(decisions, key);

      constants.push(
        toDiscoveredConstant({
          key,
          domain,
          constant: {
            ...constant,
            description: typeEntry?.description ?? constant.description,
            see,
          },
          typeEntry,
          defineLine: define?.line,
          rawValue: define?.rawValue,
          usages: usages.get(key) ?? [],
          taxonomy: taxonomyBindings.get(key) ?? [],
          parity: parityLinks.get(key),
          goldenValue: golden?.constants[key]?.value,
          schemaIssue: schema ? validateConstant(key, constant.default, schema) : null,
          lastModified: lastMod
            ? {
                decisionId: lastMod.decisionId,
                ageMs: lastMod.ageMs,
                ageLabel: formatAgeShort(lastMod.ageMs),
              }
            : undefined,
          seeResolved: resolveSeeReferences(projectRoot, see),
          literalDuplicateHits: literalDuplicates.get(key) ?? [],
          suggestionMentions: suggestionMentions.get(key) ?? [],
        })
      );
    }
  }

  constants.sort((left, right) => {
    const domainOrder = left.domain.localeCompare(right.domain);
    return domainOrder !== 0 ? domainOrder : left.key.localeCompare(right.key);
  });

  const tuningEntry = defines.find((entry) => entry.key === TUNING_SET_VERSION_KEY);

  const body = {
    tuningSetVersion: typeof tuningEntry?.value === "string" ? tuningEntry.value : "0.0.0",
    constantCount: constants.length,
    validCount: constants.filter((entry) => entry.valid).length,
    invalidCount: constants.filter((entry) => !entry.valid).length,
    orphanCount: constants.filter((entry) => entry.orphan).length,
    annotationGapCount: constants.filter((entry) => !entry.annotationsComplete).length,
    goldenDriftCount: constants.filter((entry) => entry.goldenDrift).length,
    manifestStale,
    domains: buildDomainSummaries(constants),
    alignment: buildAlignmentReport(defines, types),
    goldenDiff,
    constants,
  };

  return {
    ...body,
    healthScore: computeConstantsHealthScore(body),
  };
}
