/**
 * artifact-lineage canvas manifest — deep-link card registry + run/diff narratives.
 * Companion IDE surface: docs/canvases/artifact-lineage.canvas.tsx
 */

import type {
  DashboardRunArtifactEntry,
  DashboardRunManifestPayload,
} from "../lib/herdr-dashboard-data.ts";

export const ARTIFACT_LINEAGE_MANIFEST_ID = "artifact-lineage";

/** Cards highlighted when ?canvas=artifact-lineage (canonical-references canvasInfluences). */
export const ARTIFACT_LINEAGE_CARD_IDS = [
  "card-artifacts",
  "card-gates",
  "card-metrics-schema",
  "card-kimi-doctor",
  "card-trace-verify",
  "card-bunfig-policy",
  "card-url",
  "card-bun-runtime",
  "card-effect-image",
] as const;

export type ArtifactLineageCardId = (typeof ARTIFACT_LINEAGE_CARD_IDS)[number];

/** URLPattern for artifact-lineage deep links (search params). */
export const ARTIFACT_LINEAGE_URL_PATTERN = new URLPattern({
  search: "canvas=artifact-lineage",
});

export interface RunManifestGateDiffRow {
  gate: string;
  pathA: string | null;
  pathB: string | null;
  match: "equal" | "diff" | "missing";
}

export interface RunManifestDiff {
  runA: string;
  runB: string;
  gates: RunManifestGateDiffRow[];
}

function artifactPathMap(
  artifacts: readonly DashboardRunArtifactEntry[]
): Map<string, DashboardRunArtifactEntry> {
  return new Map(artifacts.map((row) => [row.gate, row]));
}

/** Compare hydrated artifacts from two run manifests (dashboard run diff table). */
export function computeRunManifestDiff(
  left: DashboardRunManifestPayload,
  right: DashboardRunManifestPayload
): RunManifestDiff {
  const runA = left.runId;
  const runB = right.runId;
  const gatesA = artifactPathMap(left.artifacts);
  const gatesB = artifactPathMap(right.artifacts);
  const allGates = [...new Set([...gatesA.keys(), ...gatesB.keys()])].sort();

  const gates: RunManifestGateDiffRow[] = allGates.map((gate) => {
    const a = gatesA.get(gate);
    const b = gatesB.get(gate);
    const pathA = a?.path ?? null;
    const pathB = b?.path ?? null;
    let match: RunManifestGateDiffRow["match"] = "missing";
    if (pathA && pathB) {
      match = pathA === pathB ? "equal" : "diff";
    }
    return { gate, pathA, pathB, match };
  });

  return { runA, runB, gates };
}

export const artifactLineageManifest = {
  id: ARTIFACT_LINEAGE_MANIFEST_ID,
  canvasId: ARTIFACT_LINEAGE_MANIFEST_ID,
  cardIds: ARTIFACT_LINEAGE_CARD_IDS,
  urlPattern: ARTIFACT_LINEAGE_URL_PATTERN,
  computeRunManifestDiff,
} as const;
