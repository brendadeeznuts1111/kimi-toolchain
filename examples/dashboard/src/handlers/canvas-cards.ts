import { applyCanvasFilter } from "../../../../src/lib/dashboard-canvas-filter.ts";
import { resolveDashboardProjectRoot } from "../../../../src/lib/dashboard-settings.ts";
import { fetchDashboardCanvases } from "../../../../src/lib/herdr-dashboard-data.ts";
import {
  fetchDashboardCardsPayload,
  HUB_CARD_PROBE_IDS,
  probeAllRegistryRoutes,
  type HubCardProbeId,
} from "../../../../src/lib/dashboard-card-registry.ts";
import { apiArtifacts } from "./artifacts.ts";
import { apiGates, jsonResponse } from "./api-handlers.ts";
import { apiKimiDoctor } from "./kimi-doctor.ts";
import { apiScaffold } from "./scaffold.ts";
import { apiPerfHarness, apiPerfRegistry } from "./perf-registry.ts";
import { apiSymbols } from "./symbols.ts";
import { apiEffectBenchmark } from "./effect-benchmark.ts";

const projectRoot = () => resolveDashboardProjectRoot(import.meta.dir);
const ROUTE_PROBE_TIMEOUT_MS = 5000;

const HUB_PROBE_HANDLERS: Record<HubCardProbeId, () => Promise<Response>> = {
  "card-gates": apiGates,
  "card-kimi-doctor": apiKimiDoctor,
  "card-scaffold": apiScaffold,
  "card-perf-harness": apiPerfHarness,
  "card-perf-registry": apiPerfRegistry,
  "card-effect-benchmark": apiEffectBenchmark,
  "card-symbols": apiSymbols,
  "card-artifacts": () => apiArtifacts(new Request("http://127.0.0.1/api/artifacts")),
};

async function probeHubCard(cardId: HubCardProbeId): Promise<unknown> {
  try {
    const res = await HUB_PROBE_HANDLERS[cardId]();
    if (res.ok) return await res.json();
  } catch {
    // probe failure → unknown status in registry
  }
  return undefined;
}

/** Run lightweight JSON probes for v5.5 hub cards in parallel. */
export async function collectHubCardProbes(): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    HUB_CARD_PROBE_IDS.map(async (cardId) => [cardId, await probeHubCard(cardId)] as const)
  );
  return Object.fromEntries(entries);
}

/** Hub in-process probes + parallel GET for every other card route. */
export async function collectAllCardProbes(request: Request): Promise<Record<string, unknown>> {
  const origin = new URL(request.url).origin;
  const hubSkip = new Set<string>(HUB_CARD_PROBE_IDS);
  const [hub, routes] = await Promise.all([
    collectHubCardProbes(),
    probeAllRegistryRoutes(origin, projectRoot(), {
      timeoutMs: ROUTE_PROBE_TIMEOUT_MS,
      skipCardIds: hubSkip,
    }),
  ]);

  const merged: Record<string, unknown> = { ...routes };
  for (const cardId of HUB_CARD_PROBE_IDS) {
    const inProcess = hub[cardId];
    const route = routes[cardId];
    if (inProcess !== undefined) {
      merged[cardId] = inProcess;
    } else if (route) {
      merged[cardId] = route;
    }
  }
  return merged;
}

export async function apiCanvases(): Promise<Response> {
  return jsonResponse(await fetchDashboardCanvases({ projectPath: projectRoot() }));
}

export async function apiCanvasFilter(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const result = await applyCanvasFilter(projectRoot(), url);
  return jsonResponse({
    ok: true,
    ...result,
    fetchedAt: new Date().toISOString(),
  });
}

export async function apiCards(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const canvas = url.searchParams.get("canvas");
  const orphans = url.searchParams.get("orphans") === "true";
  const deepProbe = url.searchParams.get("probe") !== "false";
  const probes = deepProbe ? await collectAllCardProbes(request) : await collectHubCardProbes();
  const payload = await fetchDashboardCardsPayload(projectRoot(), {
    canvas: orphans ? null : canvas,
    orphans,
    probes,
    probed: deepProbe,
  });
  return jsonResponse(payload);
}
