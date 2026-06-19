import { join } from "path";
import { DEFAULT_THRESHOLDS } from "./module-registry.ts";

let trainedThresholds: Record<string, number> | null = null;
let thresholdsPath = `${process.cwd()}/thresholds.json`;
let projectRoot: string | undefined;
let programmaticOverrides: Record<string, number> = {};
let cachedMerged: Record<string, number> | null = null;

/** Layer 1 — highest precedence programmatic overrides. */
export function overrideThresholds(overrides: Record<string, number>): void {
  programmaticOverrides = { ...overrides };
  cachedMerged = null;
}

export function getProgrammaticOverrides(): Record<string, number> {
  return { ...programmaticOverrides };
}

/** Test-only: reset cached thresholds and path. */
export function resetThresholdCache(outDir?: string): void {
  trainedThresholds = null;
  cachedMerged = null;
  programmaticOverrides = {};
  projectRoot = outDir;
  thresholdsPath = `${outDir ?? process.cwd()}/thresholds.json`;
}

export function setThresholdsPath(outDir: string): void {
  projectRoot = outDir;
  thresholdsPath = `${outDir.replace(/\/$/, "")}/thresholds.json`;
  trainedThresholds = null;
  cachedMerged = null;
}

export function getThresholdsPath(): string {
  return thresholdsPath;
}

async function loadTrainedThresholdsFile(): Promise<Record<string, number>> {
  try {
    const file = Bun.file(thresholdsPath);
    if (await file.exists()) {
      const parsed = (await file.json()) as Record<string, number>;
      trainedThresholds = parsed;
      console.log(`📏 Loaded trained thresholds from ${thresholdsPath}`);
      return parsed;
    }
  } catch {
    // ignore malformed trained file
  }
  return {};
}

/** Layer 2 — bunfig.toml [doctor.thresholds] (human overrides). */
export async function loadBunfigThresholds(root?: string): Promise<Record<string, number>> {
  const candidates = [
    join(root ?? projectRoot ?? process.cwd(), "bunfig.toml"),
  ];

  for (const path of candidates) {
    try {
      const file = Bun.file(path);
      if (!(await file.exists())) continue;
      const parsed = Bun.TOML.parse(await file.text()) as {
        doctor?: { thresholds?: Record<string, number> };
      };
      const thresholds = parsed.doctor?.thresholds;
      if (thresholds && typeof thresholds === "object") {
        return thresholds;
      }
    } catch {
      // try next candidate
    }
  }

  return {};
}

export interface ThresholdSources {
  defaults: Record<string, number>;
  trained: Record<string, number>;
  bunfig: Record<string, number>;
  programmatic: Record<string, number>;
  merged: Record<string, number>;
}

/** Resolve all threshold layers for reporting. Precedence: programmatic > bunfig > trained > defaults. */
export async function resolveThresholdSources(root?: string): Promise<ThresholdSources> {
  const trained = trainedThresholds ?? (await loadTrainedThresholdsFile());
  const bunfig = await loadBunfigThresholds(root);
  const programmatic = { ...programmaticOverrides };
  const merged = { ...DEFAULT_THRESHOLDS, ...trained, ...bunfig, ...programmatic };
  return {
    defaults: { ...DEFAULT_THRESHOLDS },
    trained: { ...trained },
    bunfig: { ...bunfig },
    programmatic,
    merged,
  };
}

/** Merge thresholds: defaults < trained.json < bunfig < programmatic override. */
export async function loadThresholds(): Promise<Record<string, number>> {
  if (cachedMerged) return cachedMerged;

  const sources = await resolveThresholdSources();
  cachedMerged = sources.merged;
  return cachedMerged;
}

/** Write trained thresholds (actualMs × 1.1 margin) when all metrics pass. */
export async function writeTrainedThresholds(
  thresholds: Record<string, number>,
  outDir?: string
): Promise<string> {
  const path = outDir ? `${outDir.replace(/\/$/, "")}/thresholds.json` : thresholdsPath;
  const existing = trainedThresholds ?? (await loadTrainedThresholdsFile());
  const merged = { ...existing, ...thresholds };
  await Bun.write(path, JSON.stringify(merged, null, 2));
  trainedThresholds = merged;
  thresholdsPath = path;
  cachedMerged = null;
  return path;
}
