/**
 * workflow/drift.ts — Compare current scanner output against a seed baseline.
 */

import type { DriftMap, ScannerResult, WorkflowSeedState } from "./types.ts";

function resultFingerprint(result: ScannerResult): Record<string, unknown> {
  return {
    status: result.status,
    issueCount: result.issues.length,
    issues: result.issues.map((issue) => ({
      severity: issue.severity,
      message: issue.message,
      package: issue.package,
      currentVersion: issue.currentVersion,
    })),
  };
}

/** Compute drift between live results and a stored seed snapshot. */
export function computeDrift(
  results: ScannerResult[],
  seed: WorkflowSeedState | null
): DriftMap | null {
  if (!seed) return null;

  const drift: DriftMap = {};
  const seedById = new Map(seed.results.map((row) => [row.scannerId, row]));

  for (const result of results) {
    const baseline = seedById.get(result.scannerId);
    if (!baseline) {
      drift[result.scannerId] = { type: "new_scanner", current: resultFingerprint(result) };
      continue;
    }
    const current = resultFingerprint(result);
    const previous = resultFingerprint(baseline);
    if (JSON.stringify(current) !== JSON.stringify(previous)) {
      drift[result.scannerId] = { type: "changed", previous, current };
    }
  }

  for (const baseline of seed.results) {
    if (!results.some((row) => row.scannerId === baseline.scannerId)) {
      drift[baseline.scannerId] = {
        type: "removed_scanner",
        previous: resultFingerprint(baseline),
      };
    }
  }

  return Object.keys(drift).length > 0 ? drift : {};
}
