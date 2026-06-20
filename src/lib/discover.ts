/**
 * Unified discovery — constants, dx inventory, cross-links, and health scores.
 */

import {
  computeConstantsHealthScore,
  discoverConstants,
  type DiscoverConstantsOptions,
  type DiscoverConstantsReport,
} from "./discover-constants.ts";
import {
  computeDxHealthScore,
  discoverDxInventory,
  type DiscoverDxInventoryOptions,
  type DiscoverDxInventoryReport,
} from "./discover-dx-inventory.ts";

export type DiscoverLayer = "constants" | "dx" | "all";

export interface DiscoverCrossLink {
  kind: "taxonomy-suggestion" | "port-stack" | "four-layer";
  from: string;
  to: string;
  detail: string;
}

export interface DiscoverUnifiedGap {
  source: "constants" | "dx" | "cross";
  message: string;
}

export interface DiscoverHealthSummary {
  constants: number;
  dx: number;
  overall: number;
}

export interface DiscoverUnifiedOptions {
  layers?: DiscoverLayer;
  constants?: DiscoverConstantsOptions;
  dx?: DiscoverDxInventoryOptions;
}

export interface DiscoverUnifiedReport {
  generatedAt: string;
  projectRoot: string;
  layers: DiscoverLayer[];
  constants?: DiscoverConstantsReport;
  dx?: DiscoverDxInventoryReport;
  crossLinks: DiscoverCrossLink[];
  unifiedGaps: DiscoverUnifiedGap[];
  health: DiscoverHealthSummary;
}

function buildCrossLinks(
  constants?: DiscoverConstantsReport,
  dx?: DiscoverDxInventoryReport
): DiscoverCrossLink[] {
  const links: DiscoverCrossLink[] = [];

  if (constants) {
    for (const entry of constants.constants) {
      for (const taxonomyId of entry.suggestionMentions) {
        links.push({
          kind: "taxonomy-suggestion",
          from: taxonomyId,
          to: entry.key,
          detail: "error-taxonomy suggestion references define constant",
        });
      }
    }
  }

  if (dx) {
    const examplesPort = dx.portAlignment.examplesPorts[0];
    if (examplesPort) {
      for (const endpoint of dx.endpoints.filter((entry) => entry.stack === "examples")) {
        links.push({
          kind: "port-stack",
          from: `[dashboard].port/${examplesPort}`,
          to: endpoint.name,
          detail: endpoint.url,
        });
      }
    }

    links.push({
      kind: "four-layer",
      from: "canonical-references.json",
      to: "constants-manifest.json",
      detail: "discovery layer model: references → defines → parity → scaffold",
    });
    links.push({
      kind: "four-layer",
      from: "constants-manifest.json",
      to: "dx.config.toml endpoints",
      detail: `${dx.endpointCount} endpoint rows inventory operational URLs`,
    });
  }

  return links;
}

function buildUnifiedGaps(
  constants?: DiscoverConstantsReport,
  dx?: DiscoverDxInventoryReport,
  crossLinks?: DiscoverCrossLink[]
): DiscoverUnifiedGap[] {
  const gaps: DiscoverUnifiedGap[] = [];

  if (constants) {
    if (constants.manifestStale) {
      gaps.push({ source: "constants", message: "constants-manifest.json is stale" });
    }
    if (constants.orphanCount > 0) {
      gaps.push({
        source: "constants",
        message: `${constants.orphanCount} define constants have no src/ usage`,
      });
    }
    for (const entry of constants.constants.filter((item) => !item.valid)) {
      gaps.push({
        source: "constants",
        message: `${entry.key} invalid: ${entry.validationIssues.join("; ")}`,
      });
    }
  }

  if (dx) {
    for (const gap of dx.gaps) gaps.push({ source: "dx", message: gap });
    for (const note of dx.portAlignment.notes) {
      gaps.push({ source: "dx", message: note });
    }
    if (dx.liveProbes) {
      for (const probe of dx.liveProbes.filter((entry) => !entry.ok)) {
        gaps.push({
          source: "dx",
          message: `live probe ${probe.probeId} failed: ${probe.message}`,
        });
      }
    }
    if (dx.endpointReachability) {
      for (const endpoint of dx.endpointReachability.filter(
        (entry) => !entry.skipped && !entry.reachable
      )) {
        gaps.push({
          source: "dx",
          message: `endpoint ${endpoint.name} unreachable: ${endpoint.error ?? endpoint.statusCode}`,
        });
      }
    }
  }

  if (constants && dx && crossLinks) {
    const suggested = constants.constants.filter((entry) => entry.suggestionMentions.length > 0);
    const bound = constants.constants.filter((entry) => entry.taxonomy.length > 0);
    if (suggested.length > bound.length) {
      gaps.push({
        source: "cross",
        message: `${suggested.length - bound.length} constants mentioned in taxonomy suggestions but not boundConstants`,
      });
    }
  }

  return gaps;
}

function computeOverallHealth(constants?: number, dx?: number): number {
  const scores = [constants, dx].filter((score): score is number => score !== undefined);
  if (scores.length === 0) return 0;
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

export async function discoverUnified(
  projectRoot: string,
  options: DiscoverUnifiedOptions = {}
): Promise<DiscoverUnifiedReport> {
  const layers = options.layers ?? "all";
  const includeConstants = layers === "all" || layers === "constants";
  const includeDx = layers === "all" || layers === "dx";

  const constants = includeConstants
    ? await discoverConstants(projectRoot, options.constants)
    : undefined;
  const dx = includeDx ? await discoverDxInventory(projectRoot, undefined, options.dx) : undefined;
  const crossLinks = buildCrossLinks(constants, dx);
  const unifiedGaps = buildUnifiedGaps(constants, dx, crossLinks);

  const constantsScore = constants?.healthScore;
  const dxScore = dx?.healthScore;

  return {
    generatedAt: new Date().toISOString(),
    projectRoot,
    layers: includeConstants && includeDx ? ["all"] : includeConstants ? ["constants"] : ["dx"],
    constants,
    dx,
    crossLinks,
    unifiedGaps,
    health: {
      constants: constantsScore ?? 0,
      dx: dxScore ?? 0,
      overall: computeOverallHealth(constantsScore, dxScore),
    },
  };
}

export { computeConstantsHealthScore, computeDxHealthScore };
