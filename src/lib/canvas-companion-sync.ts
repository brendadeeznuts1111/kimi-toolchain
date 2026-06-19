/**
 * Sync generated canvas companion blocks into docs/canvases/*.canvas.tsx.
 */

import { join } from "path";
import { readText, writeTextAsync } from "./bun-io.ts";
import {
  canvasCompanionFiles,
  computeHubToolchainStats,
  HUB_INVENTORY_BLOCK_RE,
  HUB_INVENTORY_LEGACY_RE,
  HUB_STATS_BLOCK_RE,
  HUB_STATS_LEGACY_RE,
  listPackageBinNames,
  patchCanvasRouting,
  patchHubToolchainCanvas,
  patchManifestLocalDocs,
  CANVAS_ROUTING_BLOCK_RE,
  MANIFEST_LOCAL_DOCS_BLOCK_RE,
  MANIFEST_LOCAL_DOCS_LEGACY_RE,
} from "./canvas-companion-data.ts";

const CANVAS_DIR = "docs/canvases";
const HUB_CANVAS = `${CANVAS_DIR}/kimi-toolchain.canvas.tsx`;
const THUMBNAILS_CANVAS = `${CANVAS_DIR}/herdr-dashboard-thumbnails.canvas.tsx`;

export interface CanvasCompanionSyncResult {
  updated: string[];
  unchanged: string[];
}

function routingBlockPresent(source: string): boolean {
  return (
    CANVAS_ROUTING_BLOCK_RE.test(source) ||
    /const CANVAS_ROUTING = \[[\s\S]*?\] as const;/.test(source)
  );
}

export async function syncCanvasCompanions(repoRoot: string): Promise<CanvasCompanionSyncResult> {
  const result: CanvasCompanionSyncResult = { updated: [], unchanged: [] };
  const stats = await computeHubToolchainStats(repoRoot);
  const binNames = await listPackageBinNames(repoRoot);

  for (const file of canvasCompanionFiles(repoRoot)) {
    const rel = `${CANVAS_DIR}/${file}`;
    const abs = join(repoRoot, rel);
    const before = await readText(abs);
    if (!routingBlockPresent(before)) {
      throw new Error(`${rel}: missing CANVAS_ROUTING block`);
    }
    const after = patchCanvasRouting(before, rel);
    if (after !== before) {
      await writeTextAsync(abs, after);
      result.updated.push(rel);
    } else {
      result.unchanged.push(rel);
    }
  }

  const thumbnailsAbs = join(repoRoot, THUMBNAILS_CANVAS);
  const thumbnailsBefore = await readText(thumbnailsAbs);
  const thumbnailsAfter = patchManifestLocalDocs(thumbnailsBefore);
  if (thumbnailsAfter !== thumbnailsBefore) {
    await writeTextAsync(thumbnailsAbs, thumbnailsAfter);
    result.updated.push(THUMBNAILS_CANVAS);
  } else if (!result.updated.includes(THUMBNAILS_CANVAS)) {
    result.unchanged.push(THUMBNAILS_CANVAS);
  }

  const hubAbs = join(repoRoot, HUB_CANVAS);
  const hubBefore = await readText(hubAbs);
  const hubAfter = patchHubToolchainCanvas(hubBefore, stats, binNames);
  if (hubAfter !== hubBefore) {
    await writeTextAsync(hubAbs, hubAfter);
    result.updated.push(HUB_CANVAS);
  } else if (!result.updated.includes(HUB_CANVAS)) {
    result.unchanged.push(HUB_CANVAS);
  }

  return result;
}

export async function canvasCompanionsStale(repoRoot: string): Promise<string[]> {
  const violations: string[] = [];
  const stats = await computeHubToolchainStats(repoRoot);
  const binNames = await listPackageBinNames(repoRoot);

  for (const file of canvasCompanionFiles(repoRoot)) {
    const rel = `${CANVAS_DIR}/${file}`;
    const source = await readText(join(repoRoot, rel));
    if (!routingBlockPresent(source)) {
      violations.push(`${rel}: missing CANVAS_ROUTING block`);
      continue;
    }
    if (patchCanvasRouting(source, rel) !== source) {
      violations.push(`${rel}: stale CANVAS_ROUTING — run: bun run canvas:generate`);
    }
  }

  const hubSource = await readText(join(repoRoot, HUB_CANVAS));
  if (!hubInventoryBlockPresent(hubSource)) {
    violations.push(`${HUB_CANVAS}: missing TOOL_INVENTORY block`);
  } else if (!hubStatsBlockPresent(hubSource)) {
    violations.push(`${HUB_CANVAS}: missing hub stats block`);
  } else if (patchHubToolchainCanvas(hubSource, stats, binNames) !== hubSource) {
    violations.push(`${HUB_CANVAS}: stale hub inventory/stats — run: bun run canvas:generate`);
  }

  const thumbnailsSource = await readText(join(repoRoot, THUMBNAILS_CANVAS));
  if (!manifestLocalDocsBlockPresent(thumbnailsSource)) {
    violations.push(`${THUMBNAILS_CANVAS}: missing MANIFEST_LOCAL_DOCS_ALL block`);
  } else if (patchManifestLocalDocs(thumbnailsSource) !== thumbnailsSource) {
    violations.push(
      `${THUMBNAILS_CANVAS}: stale manifest localDocs — run: bun run canvas:generate`
    );
  }

  return violations;
}

export function manifestLocalDocsBlockPresent(source: string): boolean {
  return MANIFEST_LOCAL_DOCS_BLOCK_RE.test(source) || MANIFEST_LOCAL_DOCS_LEGACY_RE.test(source);
}

export function hubStatsBlockPresent(source: string): boolean {
  return HUB_STATS_BLOCK_RE.test(source) || HUB_STATS_LEGACY_RE.test(source);
}

export function hubInventoryBlockPresent(source: string): boolean {
  return HUB_INVENTORY_BLOCK_RE.test(source) || HUB_INVENTORY_LEGACY_RE.test(source);
}
