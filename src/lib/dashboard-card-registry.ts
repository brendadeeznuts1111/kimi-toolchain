/**
 * examples/dashboard card registry — SSOT for canvasInfluences lint and /api/cards.
 */

import { join } from "path";
import { LOCAL_DOC_REFERENCES } from "./canonical-references.ts";
import { pathExists } from "./bun-io.ts";
import { DASHBOARD_PROBE_HEADER } from "./dashboard-logger.ts";
import { buildCardShowcaseIndex } from "./examples-showcase.ts";
import {
  DASHBOARD_HTML_REL,
  DASHBOARD_JS_REL,
  dashboardHtmlPath,
  dashboardScriptPath,
  loadDashboardCards,
  loadDashboardCardIds,
  parseDashboardCardsFromHtml,
  type DashboardCardLoaderEntry,
} from "./dashboard-card-loader.ts";

export {
  DASHBOARD_HTML_REL,
  DASHBOARD_JS_REL,
  dashboardHtmlPath,
  dashboardScriptPath,
  loadDashboardCards,
  loadDashboardCardIds,
  parseDashboardCardsFromHtml,
  type DashboardCardLoaderEntry,
};

export type DashboardCardStatus = "ok" | "warn" | "error" | "unknown";

/** v5.5 hub cards — lightweight /api/cards status probes (manifest v53-architecture influences). */
export const HUB_CARD_PROBE_IDS = [
  "card-gates",
  "card-kimi-doctor",
  "card-scaffold",
  "card-perf-harness",
  "card-perf-registry",
  "card-effect-benchmark",
  "card-symbols",
  "card-artifacts",
] as const;

export type HubCardProbeId = (typeof HUB_CARD_PROBE_IDS)[number];

/** HTTP route probe envelope stored in probes[cardId] for non-hub cards. */
export interface RouteProbeEnvelope {
  statusCode: number;
  body: unknown;
}

export function isRouteProbeEnvelope(value: unknown): value is RouteProbeEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "statusCode" in value &&
    typeof (value as RouteProbeEnvelope).statusCode === "number" &&
    "body" in value
  );
}

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
      /** Showcase entry ids that highlight this card (examples/ registry). */
      showcaseEntries?: string[];
    }
  >;
  total: number;
  filter: {
    canvas: string | null;
    manifestId: string | null;
    canvasId: string | null;
    orphans: boolean;
    /** False when `canvas` query did not match a known manifest/canvasId. */
    recognized?: boolean;
  };
  fetchedAt: string;
  /** Present when route probes ran (`probed` option / `?probe=true`). */
  probedCount?: number;
}

export function repoRootFromLibDir(libDir: string): string {
  return join(libDir, "../..");
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
  recognized: boolean;
} {
  const raw = canvasQuery?.trim();
  if (!raw) return { manifestId: null, canvasId: null, recognized: true };

  const byManifest = LOCAL_DOC_REFERENCES.find((r) => r.id === raw);
  if (byManifest?.cursorCanvas) {
    return {
      manifestId: byManifest.id,
      canvasId: byManifest.canvasId ?? raw,
      recognized: true,
    };
  }

  const byCanvasId = LOCAL_DOC_REFERENCES.find((r) => r.canvasId === raw);
  if (byCanvasId) {
    return {
      manifestId: byCanvasId.id,
      canvasId: byCanvasId.canvasId ?? raw,
      recognized: true,
    };
  }

  return { manifestId: null, canvasId: null, recognized: false };
}

export function influencesForManifest(manifestId: string): readonly string[] {
  return LOCAL_DOC_REFERENCES.find((r) => r.id === manifestId)?.canvasInfluences ?? [];
}

export function buildDashboardCardRegistry(repoRoot: string): DashboardCardEntry[] {
  const parsed = loadDashboardCards(repoRoot);
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

/** Derive status from a lightweight GET to a card's /api/* route. */
export function cardStatusFromRouteResponse(
  statusCode: number,
  body: unknown
): DashboardCardStatus {
  if (statusCode === 0) return "unknown";
  if (statusCode >= 400) return "error";
  if (typeof body === "object" && body !== null) {
    const record = body as { ok?: boolean; error?: unknown; allPass?: boolean; aligned?: boolean };
    if (record.ok === false || record.error) return "error";
    if (record.allPass === false) return "error";
    if (record.aligned === false) return "error";
    if (record.allPass === true || record.ok === true || record.aligned === true) return "ok";
  }
  return statusCode >= 200 && statusCode < 300 ? "ok" : "warn";
}

async function fetchCardRoute(
  origin: string,
  apiRoute: string,
  timeoutMs: number
): Promise<RouteProbeEnvelope> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${origin}${apiRoute}`, {
      signal: controller.signal,
      headers: { [DASHBOARD_PROBE_HEADER]: "1" },
    });
    const contentType = res.headers.get("content-type") ?? "";
    let body: unknown;
    if (contentType.includes("application/json")) {
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
    } else {
      body = await res.text();
    }
    return { statusCode: res.status, body };
  } catch {
    return { statusCode: 0, body: undefined };
  } finally {
    clearTimeout(timer);
  }
}

/** Parallel GET probes for every registry card with an apiRoute (skips hub ids when provided). */
export async function probeAllRegistryRoutes(
  origin: string,
  repoRoot: string,
  options: { timeoutMs?: number; skipCardIds?: ReadonlySet<string> } = {}
): Promise<Record<string, RouteProbeEnvelope>> {
  const registry = buildDashboardCardRegistry(repoRoot);
  const skip = options.skipCardIds ?? new Set<string>();
  const timeoutMs = options.timeoutMs ?? 5000;
  const entries = await Promise.all(
    registry
      .filter((card) => card.apiRoute && !skip.has(card.id))
      .map(async (card) => {
        const envelope = await fetchCardRoute(origin, card.apiRoute!, timeoutMs);
        return [card.id, envelope] as const;
      })
  );
  return Object.fromEntries(entries);
}

/** Derive card status from a probed API JSON payload (hub cards). */
export function cardStatusFromProbe(cardId: string, data: unknown): DashboardCardStatus {
  if (data === undefined) return "unknown";

  switch (cardId) {
    case "card-gates":
      return gateStatusFromJson(data);
    case "card-perf-harness":
    case "card-perf-registry":
    case "card-effect-benchmark": {
      const allPass = (data as { allPass?: boolean }).allPass;
      if (allPass === true) return "ok";
      if (allPass === false) return "error";
      return "unknown";
    }
    case "card-kimi-doctor": {
      const body = data as {
        live?: {
          perf?: { allPass?: boolean };
          artifacts?: { savedCount?: number };
          effectGates?: { ok?: boolean };
          ok?: boolean;
        };
        allPass?: boolean;
        ok?: boolean;
        commands?: unknown[];
      };
      if (body.live) {
        if (
          body.live.perf?.allPass === false ||
          body.allPass === false ||
          body.live.effectGates?.ok === false
        ) {
          return "error";
        }
        if (body.live.ok === true || body.ok === true) return "ok";
        if (body.live.perf?.allPass === true && (body.live.artifacts?.savedCount ?? 0) === 0) {
          return "warn";
        }
        if (body.live.perf?.allPass === true) return "ok";
        return "warn";
      }
      const commands = body.commands;
      return Array.isArray(commands) && commands.length > 0 ? "ok" : "warn";
    }
    case "card-scaffold": {
      const body = data as {
        architecture?: unknown;
        scripts?: unknown;
        templatePolicy?: { layers?: number };
        bootstrapPaths?: unknown[];
      };
      if (!body.architecture || !body.scripts) return "warn";
      if ((body.templatePolicy?.layers ?? 0) < 1) return "warn";
      if (!Array.isArray(body.bootstrapPaths) || body.bootstrapPaths.length < 1) return "warn";
      return "ok";
    }
    case "card-symbols": {
      const domain = (data as { symbols?: { domain?: unknown[] } }).symbols?.domain;
      return Array.isArray(domain) && domain.length > 0 ? "ok" : "warn";
    }
    case "card-artifacts": {
      const row = data as { ok?: boolean; count?: number };
      if (row.ok !== true) return "error";
      return (row.count ?? 0) > 0 ? "ok" : "warn";
    }
    case "card-tls-compliance": {
      const status = (data as { status?: string }).status;
      if (status === "pass") return "ok";
      if (status === "fail") return "error";
      return "unknown";
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
  const data = probes[cardId];
  if (data === undefined) return "unknown";
  if (isRouteProbeEnvelope(data)) {
    if (HUB_CARD_PROBE_IDS.includes(cardId as HubCardProbeId)) {
      const fromBody = cardStatusFromProbe(cardId, data.body);
      if (fromBody !== "unknown") return fromBody;
    }
    return cardStatusFromRouteResponse(data.statusCode, data.body);
  }
  if (HUB_CARD_PROBE_IDS.includes(cardId as HubCardProbeId)) {
    return cardStatusFromProbe(cardId, data);
  }
  return "unknown";
}

/** Build /api/cards payload; optional `canvas` query filters to influenced cards only. */
export async function fetchDashboardCardsPayload(
  repoRoot: string,
  options: {
    canvas?: string | null;
    /** When true, return only cards with no canvas manifest influences (debug). */
    orphans?: boolean;
    /** @deprecated use probes.card-gates */
    gateJson?: unknown;
    probes?: Record<string, unknown>;
    /** When true, include per-card probe counts in payload metadata. */
    probed?: boolean;
  } = {}
): Promise<DashboardCardsPayload> {
  const filter = resolveCanvasFilter(options.canvas ?? null);
  const registry = buildDashboardCardRegistry(repoRoot);
  const influenceSet =
    filter.recognized && filter.manifestId != null
      ? new Set(influencesForManifest(filter.manifestId))
      : null;
  const showcaseIndex = buildCardShowcaseIndex();

  const probes: Record<string, unknown> = { ...options.probes };
  if (options.gateJson !== undefined) probes["card-gates"] = options.gateJson;

  const cards = registry
    .filter((card) => {
      if (options.orphans) return card.influencedBy.length === 0;
      if (influenceSet) return influenceSet.has(card.id);
      return true;
    })
    .map((card) => {
      const showcaseEntries = showcaseIndex[card.id];
      return {
        ...card,
        status: resolveCardStatus(card.id, probes),
        ...(showcaseEntries?.length ? { showcaseEntries } : {}),
      };
    });

  return {
    ok: true,
    cards,
    total: cards.length,
    filter: {
      canvas: options.canvas?.trim() || null,
      manifestId: filter.manifestId,
      canvasId: filter.canvasId,
      orphans: options.orphans === true,
      recognized: filter.recognized,
    },
    fetchedAt: new Date().toISOString(),
    ...(options.probed
      ? {
          probedCount: Object.keys(probes).length,
        }
      : {}),
  };
}

export function lintCanvasInfluences(repoRoot: string): string[] {
  const violations: string[] = [];
  const htmlPath = dashboardHtmlPath(repoRoot);

  if (!pathExists(htmlPath)) {
    violations.push(`missing dashboard html: ${DASHBOARD_HTML_REL}`);
    return violations;
  }

  const cards = loadDashboardCards(repoRoot);
  const seen = new Set<string>();
  for (const card of cards) {
    if (seen.has(card.id)) {
      violations.push(`duplicate card id in dashboard.html: ${card.id}`);
    }
    seen.add(card.id);
  }
  const cardIds = seen;

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
