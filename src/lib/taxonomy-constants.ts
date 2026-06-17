/**
 * Link error taxonomy categories to bunfig define constants.
 */

import { pathExists } from "./bun-io.ts";

import { join } from "path";
import {
  generateConstantsManifest,
  loadRepoDefineMap,
  type ManifestConstant,
} from "./build-constants-registry.ts";
import { readDecisions, type Decision } from "./decision-ledger.ts";
import { loadTaxonomy, type TaxonomyCategory } from "./error-taxonomy.ts";

export interface ResolvedConstant {
  key: string;
  known: boolean;
  defineDomain?: string;
  default?: string | number | boolean;
  type?: string;
  restrictions?: string;
}

export interface TaxonomyConstantLink {
  taxonomyId: string;
  categoryName: string;
  severity: TaxonomyCategory["severity"];
  boundConstants: string[];
  resolved: ResolvedConstant[];
  invalidKeys: string[];
}

export interface TaxonomyConstantCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fixable: boolean;
}

export interface TaxonomyConstantReport {
  applicable: boolean;
  aligned: boolean;
  checks: TaxonomyConstantCheck[];
  links: TaxonomyConstantLink[];
}

function flattenManifestConstants(
  domains: Record<string, Record<string, ManifestConstant>>
): Map<string, { defineDomain: string; constant: ManifestConstant }> {
  const map = new Map<string, { defineDomain: string; constant: ManifestConstant }>();
  for (const [defineDomain, constants] of Object.entries(domains)) {
    for (const [key, constant] of Object.entries(constants)) {
      map.set(key, { defineDomain, constant });
    }
  }
  return map;
}

export async function buildTaxonomyConstantLinks(
  projectRoot: string
): Promise<TaxonomyConstantLink[]> {
  const taxonomyPath = join(projectRoot, "error-taxonomy.yml");
  if (!pathExists(taxonomyPath)) return [];

  const taxonomy = await loadTaxonomy(taxonomyPath);
  const manifest = await generateConstantsManifest(projectRoot);
  const manifestConstants = flattenManifestConstants(manifest.domains);
  const defineMap = await loadRepoDefineMap(projectRoot);

  return taxonomy.categories
    .filter((category) => (category.boundConstants?.length ?? 0) > 0)
    .map((category) => {
      const boundConstants = category.boundConstants ?? [];
      const resolved: ResolvedConstant[] = [];
      const invalidKeys: string[] = [];

      for (const key of boundConstants) {
        const manifestEntry = manifestConstants.get(key);
        const defineEntry = defineMap.get(key);
        if (!manifestEntry && !defineEntry) {
          invalidKeys.push(key);
          resolved.push({ key, known: false });
          continue;
        }

        resolved.push({
          key,
          known: true,
          defineDomain: manifestEntry?.defineDomain ?? defineEntry?.defineDomain,
          default: manifestEntry?.constant.default ?? defineEntry?.value,
          type: manifestEntry?.constant.type,
          restrictions: manifestEntry?.constant.restrictions,
        });
      }

      return {
        taxonomyId: category.id,
        categoryName: category.name,
        severity: category.severity,
        boundConstants,
        resolved,
        invalidKeys,
      };
    });
}

export async function checkTaxonomyConstantLinks(
  projectRoot: string
): Promise<TaxonomyConstantReport> {
  const taxonomyPath = join(projectRoot, "error-taxonomy.yml");
  if (!pathExists(taxonomyPath)) {
    return { applicable: false, aligned: true, checks: [], links: [] };
  }

  const links = await buildTaxonomyConstantLinks(projectRoot);
  const checks: TaxonomyConstantCheck[] = [];

  if (links.length === 0) {
    checks.push({
      name: "taxonomy-constants",
      status: "warn",
      message: "no categories declare boundConstants",
      fixable: true,
    });
    return { applicable: true, aligned: false, checks, links };
  }

  checks.push({
    name: "taxonomy-constants",
    status: "ok",
    message: `${links.length} categor${links.length === 1 ? "y" : "ies"} linked to define constants`,
    fixable: false,
  });

  for (const link of links) {
    if (link.invalidKeys.length === 0) {
      checks.push({
        name: `taxonomy:${link.taxonomyId}`,
        status: "ok",
        message: link.boundConstants.join(", "),
        fixable: false,
      });
      continue;
    }

    checks.push({
      name: `taxonomy:${link.taxonomyId}`,
      status: "error",
      message: `unknown boundConstants: ${link.invalidKeys.join(", ")}`,
      fixable: true,
    });
  }

  return {
    applicable: true,
    aligned: checks.every((check) => check.status === "ok"),
    checks,
    links,
  };
}

export async function loadFailureCountsByTaxonomy(
  ledgerPath: string
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!pathExists(ledgerPath)) return counts;

  const text = await Bun.file(ledgerPath).text();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { taxonomyId?: string; categoryId?: string };
      const id = parsed.taxonomyId || parsed.categoryId || "unknown";
      counts.set(id, (counts.get(id) ?? 0) + 1);
    } catch {
      // skip malformed lines
    }
  }

  return counts;
}

export function formatTaxonomyConstantHint(link: TaxonomyConstantLink): string {
  const tuningHints = link.resolved
    .filter((entry) => entry.known)
    .map((entry) => `${entry.key}=${String(entry.default)}`)
    .join(", ");
  return tuningHints
    ? `Tuning that may affect ${link.taxonomyId}: ${tuningHints}`
    : `No resolved constants for ${link.taxonomyId}`;
}

export function formatAgeShort(ageMs: number): string {
  const minutes = ageMs / 60_000;
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function restoredKeysFromDecision(decision: Decision): string[] {
  const restored = decision.metadata?.restoredKeys;
  return Array.isArray(restored)
    ? restored.filter((key): key is string => typeof key === "string")
    : [];
}

export function findLastConstantModification(
  decisions: Decision[],
  key: string,
  nowMs: number = Date.now()
): { ageMs: number; decisionId: string } | undefined {
  let latest: { ts: number; decisionId: string } | undefined;

  for (const decision of decisions) {
    if (decision.action !== "config-change") continue;
    if (!restoredKeysFromDecision(decision).includes(key)) continue;
    const ts = new Date(decision.timestamp).getTime();
    if (!latest || ts > latest.ts) {
      latest = { ts, decisionId: decision.decisionId };
    }
  }

  if (!latest) return undefined;
  return { ageMs: nowMs - latest.ts, decisionId: latest.decisionId };
}

const DEFAULT_BOUND_WINDOW_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * ONE_HOUR_MS;

export async function buildBoundConstantIndex(projectRoot: string): Promise<Map<string, string[]>> {
  const taxonomyPath = join(projectRoot, "error-taxonomy.yml");
  if (!pathExists(taxonomyPath)) return new Map();

  const taxonomy = await loadTaxonomy(taxonomyPath);
  const index = new Map<string, string[]>();

  for (const category of taxonomy.categories) {
    for (const key of category.boundConstants ?? []) {
      const existing = index.get(key) ?? [];
      existing.push(category.id);
      index.set(key, existing);
    }
  }

  return index;
}

function severityForModificationAge(ageMs: number): TaxonomyConstantCheck["status"] {
  if (ageMs < ONE_HOUR_MS) return "error";
  if (ageMs < SIX_HOURS_MS) return "warn";
  return "warn";
}

export async function checkRecentlyModifiedBoundConstants(
  projectRoot: string,
  options: { windowMs?: number; nowMs?: number } = {}
): Promise<TaxonomyConstantReport> {
  const windowMs = options.windowMs ?? DEFAULT_BOUND_WINDOW_MS;
  const nowMs = options.nowMs ?? Date.now();
  const taxonomyPath = join(projectRoot, "error-taxonomy.yml");

  if (!pathExists(taxonomyPath)) {
    return { applicable: false, aligned: true, checks: [], links: [] };
  }

  const index = await buildBoundConstantIndex(projectRoot);
  if (index.size === 0) {
    return { applicable: true, aligned: true, checks: [], links: [] };
  }

  const decisions = await readDecisions(projectRoot);
  const defineMap = await loadRepoDefineMap(projectRoot);
  const checks: TaxonomyConstantCheck[] = [];
  const candidateKeys = new Set<string>();

  for (const decision of decisions) {
    if (decision.action !== "config-change") continue;
    const ageMs = nowMs - new Date(decision.timestamp).getTime();
    if (ageMs < 0 || ageMs > windowMs) continue;
    for (const key of restoredKeysFromDecision(decision)) {
      if (index.has(key)) candidateKeys.add(key);
    }
  }

  for (const key of candidateKeys) {
    const lastModified = findLastConstantModification(decisions, key, nowMs);
    if (!lastModified || lastModified.ageMs > windowMs) continue;

    const taxonomyIds = index.get(key)!;
    const current = defineMap.get(key)?.value;
    const status = severityForModificationAge(lastModified.ageMs);
    const ageLabel = formatAgeShort(lastModified.ageMs);
    checks.push({
      name: key,
      status,
      message: `${key} — current: ${current ?? "(undefined)"}; modified ${ageLabel} via ${lastModified.decisionId}; bound taxonomies: ${taxonomyIds.join(", ")}; action: review cluster outcomes for these taxonomies`,
      fixable: false,
    });
  }

  if (checks.length === 0) {
    checks.push({
      name: "recent-modifications",
      status: "ok",
      message: "no bound constants modified in the last 24h",
      fixable: false,
    });
  }

  return {
    applicable: true,
    aligned: checks.every((check) => check.status === "ok"),
    checks,
    links: [],
  };
}
