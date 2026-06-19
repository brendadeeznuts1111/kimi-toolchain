/**
 * Dashboard canvas deep-link filter — URLPattern + manifest fetch for reactive card panels.
 */

import {
  artifactLineageManifest,
  ARTIFACT_LINEAGE_MANIFEST_ID,
  type RunManifestDiff,
} from "../canvases/artifact-lineage.manifest.ts";
import {
  gateHealthManifest,
  GATE_HEALTH_MANIFEST_ID,
} from "../canvases/gate-health.manifest.ts";
import {
  fetchDashboardRunManifest,
  fetchDashboardRunsList,
  type DashboardRunManifestPayload,
  type DashboardRunsListPayload,
} from "./herdr-dashboard-data.ts";

export interface CanvasDeepLinkParams {
  canvas: string | null;
  runId: string | null;
  sessionId: string | null;
  workspaceId: string | null;
  paneId: string | null;
  agentId: string | null;
  diff: { left: string; right: string } | null;
}

export type CanvasFilterAction =
  | { kind: "highlight"; canvas: string; cardIds: readonly string[] }
  | {
      kind: "run-manifest";
      canvas: string;
      cardIds: readonly string[];
      payload: DashboardRunManifestPayload;
    }
  | {
      kind: "session-runs";
      canvas: string;
      cardIds: readonly string[];
      payload: DashboardRunsListPayload;
    }
  | {
      kind: "diff-manifest";
      canvas: string;
      cardIds: readonly string[];
      left: DashboardRunManifestPayload;
      right: DashboardRunManifestPayload;
      diff: RunManifestDiff;
    };

export interface CanvasFilterResult {
  params: CanvasDeepLinkParams;
  action: CanvasFilterAction | null;
}

const CANVAS_MANIFESTS = {
  [ARTIFACT_LINEAGE_MANIFEST_ID]: artifactLineageManifest,
  [GATE_HEALTH_MANIFEST_ID]: gateHealthManifest,
} as const;

function parseDiffParam(raw: string | null): { left: string; right: string } | null {
  if (!raw?.includes("..")) return null;
  const [left, right] = raw.split("..", 2);
  if (!left?.trim() || !right?.trim()) return null;
  return { left: left.trim(), right: right.trim() };
}

/** Parse dashboard deep-link query params from a URL or location.search. */
export function parseCanvasDeepLink(input: string | URL): CanvasDeepLinkParams {
  const url =
    typeof input === "string"
      ? input.startsWith("?")
        ? new URL(`http://localhost/${input}`)
        : new URL(input, "http://localhost")
      : input;
  return {
    canvas: url.searchParams.get("canvas"),
    runId: url.searchParams.get("runId"),
    sessionId: url.searchParams.get("sessionId"),
    workspaceId: url.searchParams.get("workspaceId"),
    paneId: url.searchParams.get("paneId"),
    agentId: url.searchParams.get("agentId"),
    diff: parseDiffParam(url.searchParams.get("diff")),
  };
}

function manifestForCanvas(canvas: string | null) {
  if (!canvas) return null;
  return CANVAS_MANIFESTS[canvas as keyof typeof CANVAS_MANIFESTS] ?? null;
}

/** True when URL matches a registered canvas deep-link URLPattern. */
export function matchesCanvasDeepLink(input: string | URL, canvasId: string): boolean {
  const url =
    typeof input === "string"
      ? input.startsWith("?")
        ? new URL(`http://localhost/${input}`)
        : new URL(input, "http://localhost")
      : input;
  const manifest = manifestForCanvas(canvasId);
  if (!manifest) return false;
  return manifest.urlPattern.test(url.href);
}

/**
 * Resolve canvas filter actions for deep links.
 * `?canvas=artifact-lineage` alone → highlight only.
 * `runId` / `sessionId` / `diff` trigger manifest fetches for card-artifacts.
 */
export async function applyCanvasFilter(
  projectPath: string,
  input: string | URL
): Promise<CanvasFilterResult> {
  const params = parseCanvasDeepLink(input);
  const manifest = manifestForCanvas(params.canvas);
  if (!manifest) {
    return { params, action: null };
  }

  const cardIds = manifest.cardIds;

  if (params.diff) {
    const [left, right] = await Promise.all([
      fetchDashboardRunManifest(projectPath, params.diff.left),
      fetchDashboardRunManifest(projectPath, params.diff.right),
    ]);
    const diff = manifest.computeRunManifestDiff(left, right);
    return {
      params,
      action: {
        kind: "diff-manifest",
        canvas: manifest.id,
        cardIds,
        left,
        right,
        diff,
      },
    };
  }

  if (params.runId) {
    const payload = await fetchDashboardRunManifest(projectPath, params.runId);
    return {
      params,
      action: { kind: "run-manifest", canvas: manifest.id, cardIds, payload },
    };
  }

  if (params.sessionId || params.workspaceId || params.paneId || params.agentId) {
    const payload = await fetchDashboardRunsList(projectPath, {
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.paneId ? { paneId: params.paneId } : {}),
      ...(params.agentId ? { agentId: params.agentId } : {}),
    });
    return {
      params,
      action: { kind: "session-runs", canvas: manifest.id, cardIds, payload },
    };
  }

  return {
    params,
    action: { kind: "highlight", canvas: manifest.id, cardIds },
  };
}
