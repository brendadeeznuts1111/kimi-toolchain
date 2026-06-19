/**
 * examples/dashboard card registry — SSOT for canvasInfluences lint and /api/cards.
 */

import { join } from "path";
import { LOCAL_DOC_REFERENCES } from "./canonical-references.ts";
import { pathExists, readText } from "./bun-io.ts";

export const DASHBOARD_HTML_REL = "examples/dashboard/src/dashboard.html";

export type DashboardCardStatus = "ok" | "warn" | "error" | "unknown";

/** v5.5 hub cards — lightweight /api/cards status probes (manifest v53-architecture influences). */
export const HUB_CARD_PROBE_IDS = [
  "card-gates",
  "card-kimi-doctor",
  "card-scaffold",
  "card-perf-harness",
  "card-symbols",
  "card-perf-registry",
] as const;

export type HubCardProbeId = (typeof HUB_CARD_PROBE_IDS)[number];

export interface DashboardCardEntry {
  id: string;
  title: string;
  apiRoute: string | null;
  /** Manifest localDocs ids whose canvasInfluences include this card */
  influencedBy: string[];
}

export interface DashboardCardsPayload {
  ok: boolean;
  cards: Array<
    DashboardCardEntry & {
      status: DashboardCardStatus;
    }
  >;
  total: number;
  filter: { canvas: string | null; manifestId: string | null; canvasId: string | null };
  fetchedAt: string;
}

export function repoRootFromLibDir(libDir: string): string {
  return join(libDir, "../..");
}

export function dashboardHtmlPath(repoRoot: string): string {
  return join(repoRoot, DASHBOARD_HTML_REL);
}

/** Parse `id="card-*"` panels and primary `/api/*` route from dashboard.html script blocks. */
export function parseDashboardCardsFromHtml(html: string): Array<{
  id: string;
  title: string;
  apiRoute: string | null;
}> {
  const panels: Array<{ id: string; title: string }> = [];
  const panelRe = /id="(card-[^"]+)"[^>]*>\s*<h2>([^<]*)<\/h2>/g;
  for (const match of html.matchAll(panelRe)) {
    panels.push({ id: match[1], title: match[2].trim() });
  }

  const scriptStart = html.indexOf("<script>");
  const script = scriptStart >= 0 ? html.slice(scriptStart) : html;
  const apiByCard = new Map<string, string>();

  for (const match of script.matchAll(/card\("(card-[^"]+)"/g)) {
    const cardId = match[1];
    const idx = match.index ?? 0;
    const window = script.slice(Math.max(0, idx - 2500), idx);
    const fetchMatches = [
      ...window.matchAll(/fetchJson\("(\/api\/[^"]+)"\)/g),
      ...window.matchAll(/fetch\("(\/api\/[^"]+)"\)/g),
    ];
    if (fetchMatches.length > 0) {
      const last = fetchMatches[fetchMatches.length - 1];
      apiByCard.set(cardId, last[1]);
    }
  }

  return panels.map((panel) => ({
    ...panel,
    apiRoute: apiByCard.get(panel.id) ?? inferApiRoute(panel.id),
  }));
}

function inferApiRoute(cardId: string): string | null {
  const overrides: Record<string, string> = {
    "card-depth": "/api/console-depth",
    "card-build": "/api/build-info",
    "card-dotenv": "/api/dotenv",
    "card-crypto-hash": "/api/crypto-hash",
    "card-file-io": "/api/file-io",
    "card-effect-image": "/api/effect-image",
    "card-kimi-doctor": "/api/kimi-doctor",
    "card-perf-harness": "/api/perf-harness",
    "card-perf-registry": "/api/perf-registry",
    "card-perf-auto-discover": "/api/perf-auto-discover",
    "card-threshold-overrides": "/api/threshold-overrides",
    "card-kimi-publish": "/api/kimi-publish",
    "card-file-split": "/api/file-split",
    "card-extract-methods": "/api/extract-methods",
    "card-transpiler-scan": "/api/transpiler-scan",
    "card-shadow-realm": "/api/shadow-realm",
    "card-vm-context": "/api/vm-context",
    "card-ipc-matrix": "/api/ipc-matrix",
    "card-set-headers": "/api/set-headers",
    "card-metrics-schema": "/api/metrics-schema",
    "card-perf-threaded": "/api/perf-threaded",
    "card-global-store": "/api/global-store",
    "card-trace-verify": "/api/trace-verify",
    "card-deep-match": "/api/deep-match",
    "card-bun-test": "/api/bun-test",
    "card-build-compile": "/api/build-compile",
    "card-strip-ansi": "/api/strip-ansi",
    "card-inspect-defaults": "/api/inspect-defaults",
    "card-inspect-table": "/api/inspect-table",
    "card-write-smart": "/api/write-smart",
    "card-stream-hash": "/api/stream-hash",
    "card-node-http": "/api/node-http",
    "card-spawn-sync": "/api/spawn-sync",
    "card-url-node": "/api/url-node",
    "card-util-types": "/api/util-types",
    "card-glob-orphan": "/api/glob-orphan",
    "card-random-bytes": "/api/random-bytes",
  };
  if (overrides[cardId]) return overrides[cardId];
  if (!cardId.startsWith("card-")) return null;
  const slug = cardId.slice("card-".length);
  return `/api/${slug}`;
}

export function loadDashboardCardIds(repoRoot: string): string[] {
  const path = dashboardHtmlPath(repoRoot);
  const html = readText(path);
  return parseDashboardCardsFromHtml(html).map((c) => c.id);
}

function buildInfluenceReverseMap(): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const ref of LOCAL_DOC_REFERENCES) {
    if (!ref.canvasInfluences?.length) continue;
    for (const cardId of ref.canvasInfluences) {
      const list = reverse.get(cardId) ?? [];
      list.push(ref.id);
      reverse.set(cardId, list);
    }
  }
  return reverse;
}

export function resolveCanvasFilter(canvasQuery: string | null | undefined): {
  manifestId: string | null;
  canvasId: string | null;
} {
  const raw = canvasQuery?.trim();
  if (!raw) return { manifestId: null, canvasId: null };

  const byManifest = LOCAL_DOC_REFERENCES.find((r) => r.id === raw);
  if (byManifest?.cursorCanvas) {
    return {
      manifestId: byManifest.id,
      canvasId: byManifest.canvasId ?? raw,
    };
  }

  const byCanvasId = LOCAL_DOC_REFERENCES.find((r) => r.canvasId === raw);
  if (byCanvasId) {
    return { manifestId: byCanvasId.id, canvasId: byCanvasId.canvasId ?? raw };
  }

  return { manifestId: raw, canvasId: raw };
}

export function influencesForManifest(manifestId: string): readonly string[] {
  return LOCAL_DOC_REFERENCES.find((r) => r.id === manifestId)?.canvasInfluences ?? [];
}

export function buildDashboardCardRegistry(repoRoot: string): DashboardCardEntry[] {
  const path = dashboardHtmlPath(repoRoot);
  const html = readText(path);
  const parsed = parseDashboardCardsFromHtml(html);
  const reverse = buildInfluenceReverseMap();

  return parsed.map((card) => ({
    id: card.id,
    title: card.title,
    apiRoute: card.apiRoute,
    influencedBy: reverse.get(card.id) ?? [],
  }));
}

function gateStatusFromJson(data: unknown): DashboardCardStatus {
  const envelope = data as {
    effectGates?: { summary?: { ok?: boolean } };
    summary?: { ok?: boolean };
    violations?: Array<{ severity?: string }>;
  };
  const summaryOk = envelope.summary?.ok ?? envelope.effectGates?.summary?.ok;
  if (summaryOk === true) return "ok";
  if (summaryOk === false) return "error";
  const errors = (envelope.violations ?? []).filter((v) => v.severity === "error");
  if (errors.length > 0) return "error";
  return "unknown";
}

/** Derive card status from a probed API JSON payload (hub cards only). */
export function cardStatusFromProbe(cardId: string, data: unknown): DashboardCardStatus {
  if (data === undefined) return "unknown";

  switch (cardId) {
    case "card-gates":
      return gateStatusFromJson(data);
    case "card-perf-harness":
    case "card-perf-registry": {
      const allPass = (data as { allPass?: boolean }).allPass;
      if (allPass === true) return "ok";
      if (allPass === false) return "error";
      return "unknown";
    }
    case "card-kimi-doctor": {
      const commands = (data as { commands?: unknown[] }).commands;
      return Array.isArray(commands) && commands.length > 0 ? "ok" : "warn";
    }
    case "card-scaffold": {
      const body = data as { architecture?: unknown; scripts?: unknown };
      return body.architecture && body.scripts ? "ok" : "warn";
    }
    case "card-symbols": {
      const domain = (data as { symbols?: { domain?: unknown[] } }).symbols?.domain;
      return Array.isArray(domain) && domain.length > 0 ? "ok" : "warn";
    }
    default:
      return "unknown";
  }
}

function resolveCardStatus(
  cardId: string,
  probes: Record<string, unknown> | undefined
): DashboardCardStatus {
  if (!probes || !(cardId in probes)) return "unknown";
  if (!HUB_CARD_PROBE_IDS.includes(cardId as HubCardProbeId)) return "unknown";
  return cardStatusFromProbe(cardId, probes[cardId]);
}

/** Build /api/cards payload; optional `canvas` query filters to influenced cards only. */
export async function fetchDashboardCardsPayload(
  repoRoot: string,
  options: {
    canvas?: string | null;
    /** @deprecated use probes.card-gates */
    gateJson?: unknown;
    probes?: Record<string, unknown>;
  } = {}
): Promise<DashboardCardsPayload> {
  const filter = resolveCanvasFilter(options.canvas ?? null);
  const registry = buildDashboardCardRegistry(repoRoot);
  const influenceSet =
    filter.manifestId != null ? new Set(influencesForManifest(filter.manifestId)) : null;

  const probes: Record<string, unknown> = { ...options.probes };
  if (options.gateJson !== undefined) probes["card-gates"] = options.gateJson;

  const cards = registry
    .filter((card) => (influenceSet ? influenceSet.has(card.id) : true))
    .map((card) => ({
      ...card,
      status: resolveCardStatus(card.id, probes),
    }));

  return {
    ok: true,
    cards,
    total: cards.length,
    filter: {
      canvas: options.canvas?.trim() || null,
      manifestId: filter.manifestId,
      canvasId: filter.canvasId,
    },
    fetchedAt: new Date().toISOString(),
  };
}

export function lintCanvasInfluences(repoRoot: string): string[] {
  const violations: string[] = [];
  const cardIds = new Set(loadDashboardCardIds(repoRoot));
  const htmlPath = dashboardHtmlPath(repoRoot);

  if (!pathExists(htmlPath)) {
    violations.push(`missing dashboard html: ${DASHBOARD_HTML_REL}`);
    return violations;
  }

  for (const ref of LOCAL_DOC_REFERENCES) {
    if (!ref.canvasInfluences?.length) {
      if (ref.cursorCanvas) {
        violations.push(`${ref.id}: cursorCanvas without canvasInfluences`);
      }
      continue;
    }
    for (const cardId of ref.canvasInfluences) {
      if (!cardIds.has(cardId)) {
        violations.push(`${ref.id}: unknown card id ${cardId}`);
      }
    }
  }

  return violations;
}
