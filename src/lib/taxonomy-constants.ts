/**
 * Link error taxonomy categories to bunfig define constants.
 */

import { existsSync } from "fs";
import { join } from "path";
import {
  generateConstantsManifest,
  loadRepoDefineMap,
  type ManifestConstant,
} from "./build-constants-registry.ts";
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
  relatedConstants: string[];
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
  if (!existsSync(taxonomyPath)) return [];

  const taxonomy = await loadTaxonomy(taxonomyPath);
  const manifest = await generateConstantsManifest(projectRoot);
  const manifestConstants = flattenManifestConstants(manifest.domains);
  const defineMap = await loadRepoDefineMap(projectRoot);

  return taxonomy.categories
    .filter((category) => (category.relatedConstants?.length ?? 0) > 0)
    .map((category) => {
      const relatedConstants = category.relatedConstants ?? [];
      const resolved: ResolvedConstant[] = [];
      const invalidKeys: string[] = [];

      for (const key of relatedConstants) {
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
        relatedConstants,
        resolved,
        invalidKeys,
      };
    });
}

export async function checkTaxonomyConstantLinks(
  projectRoot: string
): Promise<TaxonomyConstantReport> {
  const taxonomyPath = join(projectRoot, "error-taxonomy.yml");
  if (!existsSync(taxonomyPath)) {
    return { applicable: false, aligned: true, checks: [], links: [] };
  }

  const links = await buildTaxonomyConstantLinks(projectRoot);
  const checks: TaxonomyConstantCheck[] = [];

  if (links.length === 0) {
    checks.push({
      name: "taxonomy-constants",
      status: "warn",
      message: "no categories declare relatedConstants",
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
        message: link.relatedConstants.join(", "),
        fixable: false,
      });
      continue;
    }

    checks.push({
      name: `taxonomy:${link.taxonomyId}`,
      status: "error",
      message: `unknown relatedConstants: ${link.invalidKeys.join(", ")}`,
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
  if (!existsSync(ledgerPath)) return counts;

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
