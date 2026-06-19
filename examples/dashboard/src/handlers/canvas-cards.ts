import { join } from "path";
import { fetchDashboardCanvases } from "../../../../src/lib/herdr-dashboard-data.ts";
import {
  fetchDashboardCardsPayload,
  HUB_CARD_PROBE_IDS,
  type HubCardProbeId,
} from "../../../../src/lib/dashboard-card-registry.ts";
import { apiGates, jsonResponse } from "./api-handlers.ts";
import { apiKimiDoctor } from "./kimi-doctor.ts";
import { apiScaffold } from "./scaffold.ts";
import { apiPerfHarness, apiPerfRegistry } from "./perf-registry.ts";
import { apiSymbols } from "./symbols.ts";
import { apiEffectBenchmark } from "./effect-benchmark.ts";

const REPO_ROOT = join(import.meta.dir, "../../../..");

const HUB_PROBE_HANDLERS: Record<HubCardProbeId, () => Promise<Response>> = {
  "card-gates": apiGates,
  "card-kimi-doctor": apiKimiDoctor,
  "card-scaffold": apiScaffold,
  "card-perf-harness": apiPerfHarness,
  "card-perf-registry": apiPerfRegistry,
  "card-effect-benchmark": apiEffectBenchmark,
  "card-symbols": apiSymbols,
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

export function apiCanvases(): Response {
  return jsonResponse(fetchDashboardCanvases());
}

export async function apiCards(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const canvas = url.searchParams.get("canvas");
  const probes = await collectHubCardProbes();
  const payload = await fetchDashboardCardsPayload(REPO_ROOT, { canvas, probes });
  return jsonResponse(payload);
}
