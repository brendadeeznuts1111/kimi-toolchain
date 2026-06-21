import { ArtifactStore, type ArtifactListOptions } from "../../artifact-store.ts";
import { LOCAL_DOC_REFERENCES } from "../../canonical-references.ts";
import {
  buildDashboardDeepLink,
  isBridgedCanvasManifest,
  type DashboardCompanionQuery,
  type HerdrCanvasContext,
} from "../server/bridge.ts";

export interface DashboardCanvasEntry {
  /** Manifest domain id (e.g. "code-references") */
  id: string;
  /** Canvas self-identifier (e.g. "doc-links-and-see-ladder"). Matches CANVAS_ROUTING.id. */
  canvasId: string;
  /** Canvas display name (e.g. "Doc links") — from CANVAS_ROUTING.page */
  page: string;
  /** Repo-relative path (e.g. docs/canvases/doc-links-and-see-ladder.canvas.tsx) */
  path: string;
  /** Manifest purpose string */
  purpose: string;
  /** Canvas version (e.g. "0.1.0") — from CANVAS_ROUTING.version */
  version?: string;
  /** Canvas layer label (e.g. "Doc URL lint") — from CANVAS_ROUTING.layer */
  layer?: string;
  /** When-to-open hint (e.g. "@see ladder") — from CANVAS_ROUTING.openWhen */
  openWhen?: string;
  /** Read order for grouping (1=Hub, 2=Config/Namespace, 3=Cross-ref, 4=Scaffold, 5-6=Herdr) */
  readOrder?: number;
  /** examples/dashboard card ids influenced by this canvas (v5.4) */
  influences?: string[];
  /** Examples dashboard deep link when canvas supports reactive cards (v5.5 Herdr bridge) */
  dashboardDeepLink?: string;
}

export interface DashboardCanvasesPayload {
  ok: boolean;
  canvases: DashboardCanvasEntry[];
  /** Run id baked into bridged companion links (explicit query or latest manifest). */
  activeRunId?: string;
  fetchedAt: string;
}

export interface FetchDashboardCanvasesOptions {
  projectPath?: string;
  companion?: DashboardCompanionQuery;
  baseUrl?: string;
}

/** Resolve run/session/gate context for examples dashboard companion deep links. */
export async function resolveDashboardCompanionContext(
  projectPath: string,
  query: DashboardCompanionQuery = {}
): Promise<Pick<HerdrCanvasContext, "runId" | "sessionId" | "gate">> {
  const explicitRunId = query.runId?.trim();
  const sessionId = query.sessionId?.trim();
  const gate = query.gate?.trim();

  if (explicitRunId) {
    return {
      runId: explicitRunId,
      ...(sessionId ? { sessionId } : {}),
      ...(gate ? { gate } : {}),
    };
  }

  const store = new ArtifactStore(projectPath);
  const filter: ArtifactListOptions = { limit: 1 };
  if (sessionId) filter.sessionId = sessionId;
  const manifests = await store.listRunManifests(filter);
  const latestRunId = manifests[0]?.runId;

  return {
    ...(latestRunId ? { runId: latestRunId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(gate ? { gate } : {}),
  };
}

/** All manifest-backed cursorCanvas companions for the dashboard navigator. */
export async function fetchDashboardCanvases(
  options: FetchDashboardCanvasesOptions = {}
): Promise<DashboardCanvasesPayload> {
  const canvases: DashboardCanvasEntry[] = [];
  const canvasPrefix = "docs/canvases/";

  let companionCtx: Pick<HerdrCanvasContext, "runId" | "sessionId" | "gate"> = {};
  if (options.projectPath) {
    companionCtx = await resolveDashboardCompanionContext(
      options.projectPath,
      options.companion ?? {}
    );
  } else if (options.companion?.runId?.trim()) {
    companionCtx = {
      runId: options.companion.runId.trim(),
      ...(options.companion.sessionId?.trim()
        ? { sessionId: options.companion.sessionId.trim() }
        : {}),
      ...(options.companion.gate?.trim() ? { gate: options.companion.gate.trim() } : {}),
    };
  }

  for (const ref of LOCAL_DOC_REFERENCES) {
    if (!ref.cursorCanvas) continue;
    const canvasId =
      ref.canvasId ?? ref.cursorCanvas.replace(canvasPrefix, "").replace(".canvas.tsx", "");
    const entry: DashboardCanvasEntry = {
      id: ref.id,
      canvasId,
      page: ref.canvasPage ?? ref.cursorCanvas.replace(canvasPrefix, "").replace(".canvas.tsx", ""),
      path: ref.cursorCanvas,
      purpose: ref.purpose ?? "",
      version: ref.canvasVersion,
      layer: ref.canvasLayer,
      openWhen: ref.canvasOpenWhen,
      readOrder: ref.canvasReadOrder,
      influences: ref.canvasInfluences ? [...ref.canvasInfluences] : undefined,
    };
    if (isBridgedCanvasManifest(canvasId)) {
      entry.dashboardDeepLink = buildDashboardDeepLink(
        { manifestId: canvasId, ...companionCtx },
        { baseUrl: options.baseUrl }
      );
    }
    canvases.push(entry);
  }

  canvases.sort((a, b) => (a.readOrder ?? 99) - (b.readOrder ?? 99));

  return {
    ok: true,
    canvases,
    ...(companionCtx.runId ? { activeRunId: companionCtx.runId } : {}),
    fetchedAt: new Date().toISOString(),
  };
}
