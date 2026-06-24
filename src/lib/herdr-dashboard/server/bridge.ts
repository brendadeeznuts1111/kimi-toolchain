/**
 * Herdr ↔ examples dashboard bridge — deep links from canvas companions to reactive cards.
 */

import { BENCHMARK_MANIFEST_ID } from "../../../canvases/benchmark.manifest.ts";
import { GATE_HEALTH_MANIFEST_ID } from "../../../canvases/gate-health.manifest.ts";
import { ARTIFACT_LINEAGE_MANIFEST_ID } from "../../../canvases/artifact-lineage.manifest.ts";
import { parseCanvasDeepLink } from "../../dashboard-canvas-filter.ts";
import { DEFAULT_EXAMPLES_DASHBOARD_URL } from "../../examples-dashboard-companion.ts";

export interface HerdrCanvasContext {
  /** Canvas manifest id (e.g. "artifact-lineage"). */
  manifestId: string;
  runId?: string;
  sessionId?: string;
  diff?: { left: string; right: string };
  gate?: string;
}

/** Query params for run-aware examples dashboard companion links. */
export interface DashboardCompanionQuery {
  runId?: string;
  sessionId?: string;
  gate?: string;
}

export function parseDashboardCompanionQuery(
  searchParams: URLSearchParams
): DashboardCompanionQuery {
  const runId = searchParams.get("runId")?.trim();
  const sessionId = searchParams.get("sessionId")?.trim();
  const gate = searchParams.get("gate")?.trim();
  return {
    ...(runId ? { runId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(gate ? { gate } : {}),
  };
}

/** Manifest ids that expose examples dashboard deep links from Herdr canvas rows. */
export const BRIDGED_CANVAS_MANIFEST_IDS = [
  ARTIFACT_LINEAGE_MANIFEST_ID,
  GATE_HEALTH_MANIFEST_ID,
  BENCHMARK_MANIFEST_ID,
] as const;

export type BridgedCanvasManifestId = (typeof BRIDGED_CANVAS_MANIFEST_IDS)[number];

export function isBridgedCanvasManifest(manifestId: string): manifestId is BridgedCanvasManifestId {
  return (BRIDGED_CANVAS_MANIFEST_IDS as readonly string[]).includes(manifestId);
}

function resolveDashboardBaseUrl(baseUrl?: string): string {
  const raw =
    baseUrl?.trim() ||
    Bun.env.HERDR_EXAMPLES_DASHBOARD_URL?.trim() ||
    DEFAULT_EXAMPLES_DASHBOARD_URL;
  return raw.endsWith("/") ? raw : `${raw}/`;
}

/** Build examples dashboard URL with canvas deep-link query params. */
export function buildDashboardDeepLink(
  ctx: HerdrCanvasContext,
  options?: { baseUrl?: string }
): string {
  const url = new URL(resolveDashboardBaseUrl(options?.baseUrl));
  url.searchParams.set("canvas", ctx.manifestId);
  if (ctx.runId) url.searchParams.set("runId", ctx.runId);
  if (ctx.sessionId) url.searchParams.set("sessionId", ctx.sessionId);
  if (ctx.gate) url.searchParams.set("gate", ctx.gate);
  if (ctx.diff) url.searchParams.set("diff", `${ctx.diff.left}..${ctx.diff.right}`);
  return url.toString();
}

/** Parse examples dashboard deep-link URL into Herdr canvas context. */
export function parseHerdrCanvasUrl(input: string): HerdrCanvasContext | null {
  const params = parseCanvasDeepLink(input);
  if (!params.canvas) return null;

  const parsed = input.startsWith("?")
    ? new URL(`http://localhost/${input}`)
    : new URL(input, "http://localhost");
  const gate = parsed.searchParams.get("gate");

  const ctx: HerdrCanvasContext = { manifestId: params.canvas };
  if (params.runId) ctx.runId = params.runId;
  if (params.sessionId) ctx.sessionId = params.sessionId;
  if (params.diff) ctx.diff = params.diff;
  if (gate) ctx.gate = gate;
  return ctx;
}

/** Render an HTML anchor for the examples dashboard companion link. */
export function renderHerdrCanvasCompanion(
  ctx: HerdrCanvasContext,
  options?: { baseUrl?: string; label?: string }
): string {
  const href = buildDashboardDeepLink(ctx, options);
  const label = options?.label ?? "Examples dashboard";
  return `<a href="${Bun.escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${Bun.escapeHTML(label)}</a>`;
}
