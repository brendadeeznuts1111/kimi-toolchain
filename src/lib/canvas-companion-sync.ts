/**
 * Sync generated canvas companion blocks into docs/canvases/*.canvas.tsx.
 */

import { tmpdir } from "os";
import { join } from "path";
import { makeDir, readText, removePath } from "./bun-io.ts";
import { readableStreamToText } from "./bun-utils.ts";
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

const TOOLCHAIN_REPO_ROOT = join(import.meta.dir, "..", "..");

export interface CanvasCompanionSyncResult {
  updated: string[];
  unchanged: string[];
}

interface CanvasFilePatch {
  relPath: string;
  abs: string;
  before: string;
  after: string;
}

function routingBlockPresent(source: string): boolean {
  return (
    CANVAS_ROUTING_BLOCK_RE.test(source) ||
    /const CANVAS_ROUTING = \[[\s\S]*?\] as const;/.test(source)
  );
}

function oxfmtPath(): string {
  return join(TOOLCHAIN_REPO_ROOT, "node_modules", ".bin", "oxfmt");
}

/** Format a batch of TSX source strings with the repo's oxfmt config. */
async function formatCanvasSources(
  repoRoot: string,
  entries: Array<{ relPath: string; source: string }>
): Promise<Map<string, string>> {
  const dir = join(tmpdir(), `kimi-canvas-${Bun.randomUUIDv7()}`);
  await makeDir(dir, { recursive: true });
  const relToTmp = new Map<string, string>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const tmp = join(dir, `${i}.tsx`);
    relToTmp.set(entry.relPath, tmp);
    await Bun.write(tmp, entry.source);
  }
  try {
    const proc = Bun.spawn(
      [
        oxfmtPath(),
        "--write",
        "-c",
        join(TOOLCHAIN_REPO_ROOT, ".oxfmtrc.json"),
        ...relToTmp.values(),
      ],
      {
        stdout: "ignore",
        stderr: "pipe",
      }
    );
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const err = await readableStreamToText(proc.stderr);
      throw new Error(`oxfmt failed: ${err}`);
    }
    const result = new Map<string, string>();
    for (const [relPath, tmp] of relToTmp) {
      result.set(relPath, await readText(tmp));
    }
    return result;
  } finally {
    removePath(dir, { recursive: true, force: true });
  }
}

export async function syncCanvasCompanions(repoRoot: string): Promise<CanvasCompanionSyncResult> {
  const result: CanvasCompanionSyncResult = { updated: [], unchanged: [] };
  const stats = await computeHubToolchainStats(repoRoot);
  const binNames = await listPackageBinNames(repoRoot);

  const patches: CanvasFilePatch[] = [];

  for (const file of canvasCompanionFiles(repoRoot)) {
    const rel = `${CANVAS_DIR}/${file}`;
    const abs = join(repoRoot, rel);
    const before = await readText(abs);
    if (!routingBlockPresent(before)) {
      throw new Error(`${rel}: missing CANVAS_ROUTING block`);
    }
    patches.push({ relPath: rel, abs, before, after: patchCanvasRouting(before, rel) });
  }

  const thumbnailsAbs = join(repoRoot, THUMBNAILS_CANVAS);
  const thumbnailsBefore = await readText(thumbnailsAbs);
  patches.push({
    relPath: THUMBNAILS_CANVAS,
    abs: thumbnailsAbs,
    before: thumbnailsBefore,
    after: patchManifestLocalDocs(thumbnailsBefore),
  });

  const hubAbs = join(repoRoot, HUB_CANVAS);
  const hubBefore = await readText(hubAbs);
  const hubWithRouting = patchCanvasRouting(hubBefore, HUB_CANVAS);
  patches.push({
    relPath: HUB_CANVAS,
    abs: hubAbs,
    before: hubBefore,
    after: patchHubToolchainCanvas(hubWithRouting, stats, binNames),
  });

  const afters = patches.map((p) => ({ relPath: p.relPath, source: p.after }));
  const formatted = await formatCanvasSources(repoRoot, afters);

  for (const patch of patches) {
    const after = formatted.get(patch.relPath)!;
    if (after !== patch.before) {
      await Bun.write(patch.abs, after);
      result.updated.push(patch.relPath);
    } else {
      result.unchanged.push(patch.relPath);
    }
  }

  return result;
}

export async function canvasCompanionsStale(repoRoot: string): Promise<string[]> {
  const violations: string[] = [];
  const stats = await computeHubToolchainStats(repoRoot);
  const binNames = await listPackageBinNames(repoRoot);

  const toFormat: Array<{ relPath: string; source: string }> = [];

  for (const file of canvasCompanionFiles(repoRoot)) {
    const rel = `${CANVAS_DIR}/${file}`;
    const source = await readText(join(repoRoot, rel));
    if (!routingBlockPresent(source)) {
      violations.push(`${rel}: missing CANVAS_ROUTING block`);
      continue;
    }
    toFormat.push({ relPath: rel, source });
    toFormat.push({ relPath: `${rel}:expected`, source: patchCanvasRouting(source, rel) });
  }

  const hubSource = await readText(join(repoRoot, HUB_CANVAS));
  if (!hubInventoryBlockPresent(hubSource)) {
    violations.push(`${HUB_CANVAS}: missing TOOL_INVENTORY block`);
  } else if (!hubStatsBlockPresent(hubSource)) {
    violations.push(`${HUB_CANVAS}: missing hub stats block`);
  } else {
    toFormat.push({ relPath: HUB_CANVAS, source: hubSource });
    toFormat.push({
      relPath: `${HUB_CANVAS}:expected`,
      source: patchHubToolchainCanvas(hubSource, stats, binNames),
    });
  }

  const thumbnailsSource = await readText(join(repoRoot, THUMBNAILS_CANVAS));
  if (!manifestLocalDocsBlockPresent(thumbnailsSource)) {
    violations.push(`${THUMBNAILS_CANVAS}: missing MANIFEST_LOCAL_DOCS_ALL block`);
  } else {
    toFormat.push({ relPath: THUMBNAILS_CANVAS, source: thumbnailsSource });
    toFormat.push({
      relPath: `${THUMBNAILS_CANVAS}:expected`,
      source: patchManifestLocalDocs(thumbnailsSource),
    });
  }

  if (toFormat.length === 0) return violations;

  const formatted = await formatCanvasSources(repoRoot, toFormat);

  for (const file of canvasCompanionFiles(repoRoot)) {
    const rel = `${CANVAS_DIR}/${file}`;
    if (violations.some((v) => v.startsWith(`${rel}:`))) continue;
    const actual = formatted.get(rel);
    const expected = formatted.get(`${rel}:expected`);
    if (actual !== expected) {
      violations.push(`${rel}: stale CANVAS_ROUTING — run: bun run canvas:generate`);
    }
  }

  if (!violations.some((v) => v.startsWith(`${HUB_CANVAS}:`))) {
    const actual = formatted.get(HUB_CANVAS);
    const expected = formatted.get(`${HUB_CANVAS}:expected`);
    if (actual !== expected) {
      violations.push(`${HUB_CANVAS}: stale hub inventory/stats — run: bun run canvas:generate`);
    }
  }

  if (!violations.some((v) => v.startsWith(`${THUMBNAILS_CANVAS}:`))) {
    const actual = formatted.get(THUMBNAILS_CANVAS);
    const expected = formatted.get(`${THUMBNAILS_CANVAS}:expected`);
    if (actual !== expected) {
      violations.push(
        `${THUMBNAILS_CANVAS}: stale manifest localDocs — run: bun run canvas:generate`
      );
    }
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
