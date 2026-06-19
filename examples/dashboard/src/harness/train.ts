import { thresholdKeyFor } from "./module-registry.ts";
import { writeTrainedThresholds } from "./thresholds.ts";
import type { Metric, TrainResult } from "./types.ts";

const TRAIN_MARGIN = 1.1;

/** If all metrics pass, write thresholds.json with actualMs × 1.1 margin. */
export async function trainThresholds(
  metrics: Metric[],
  outDir?: string
): Promise<TrainResult> {
  const measured = metrics.filter((m) => !m.skipped);
  const allPass = measured.every((m) => m.pass && !Number.isNaN(m.actualMs));
  const path = outDir ? `${outDir.replace(/\/$/, "")}/thresholds.json` : `${process.cwd()}/thresholds.json`;

  if (!allPass) {
    return { written: false, path, thresholds: {} };
  }

  const thresholds: Record<string, number> = {};
  for (const m of measured) {
    const key = m.registryKey ? thresholdKeyFor(m.registryKey) : `${m.symbol}.${m.operation}`;
    thresholds[key] = Math.round(m.actualMs * TRAIN_MARGIN * 1000) / 1000;
  }

  await writeTrainedThresholds(thresholds, outDir);
  console.log(`✅ Trained thresholds written to ${path}`);
  return { written: true, path, thresholds };
}
