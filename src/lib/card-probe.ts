/**
 * Live card status probes — CLI + cross-dashboard orchestration.
 * SSOT types for card health; implementation delegates to /api/cards and /api/health.
 */

import type { DashboardCardStatus, DashboardCardsPayload } from "./dashboard-card-registry.ts";
import { auditConfigLayersStatus } from "./config-status.ts";

export interface CardProbeConfig {
  examplesDashboardUrl?: string;
  herdrDashboardUrl?: string;
  timeoutMs?: number;
}

export interface CardStatus {
  cardId: string;
  source: "examples" | "herdr" | "config-status";
  status: "pass" | "fail" | "pending" | "unknown";
  lastUpdated: string;
  artifactUrl?: string;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
/** Examples dashboard ports — canonical 5678 first, 3000/8080 retained as legacy fallback. */
const EXAMPLES_PORTS = [5678, 3000, 8080] as const;
const HERDR_PORTS = [18412] as const;

export function displayCardId(id: string): string {
  return id.startsWith("card-") ? id.slice("card-".length) : id;
}

export function dashboardStatusToProbe(status: DashboardCardStatus | string): CardStatus["status"] {
  if (status === "ok") return "pass";
  if (status === "unknown" || status === "pending") return "unknown";
  return "fail";
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Try common ports against a health path; return the first that responds OK. */
export async function discoverPort(
  ports: readonly number[],
  path: string,
  timeoutMs: number
): Promise<number | null> {
  for (const port of ports) {
    try {
      const res = await fetchWithTimeout(`http://127.0.0.1:${port}${path}`, timeoutMs);
      if (res.ok) return port;
    } catch {
      /* try next port */
    }
  }
  return null;
}

async function resolveExamplesBaseUrl(config: CardProbeConfig): Promise<string | null> {
  const explicit = config.examplesDashboardUrl?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const port = await discoverPort(
    EXAMPLES_PORTS,
    "/health",
    config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  return port != null ? `http://127.0.0.1:${port}` : null;
}

async function resolveHerdrBaseUrl(config: CardProbeConfig): Promise<string | null> {
  const explicit =
    config.herdrDashboardUrl?.trim() || (Bun.env.HERDR_DASHBOARD_URL ?? "").trim() || undefined;
  if (explicit) return explicit.replace(/\/$/, "");
  const port = await discoverPort(
    HERDR_PORTS,
    "/api/health",
    config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  return port != null ? `http://127.0.0.1:${port}` : null;
}

function cardsPayloadToStatuses(payload: DashboardCardsPayload, source: "examples"): CardStatus[] {
  return payload.cards.map((card) => ({
    cardId: displayCardId(card.id),
    source,
    status: dashboardStatusToProbe(card.status),
    lastUpdated: payload.fetchedAt,
    artifactUrl: card.apiRoute ?? undefined,
    error: card.status === "error" ? `${card.title} probe failed` : undefined,
  }));
}

function unknownRow(
  source: "examples" | "herdr" | "config-status",
  cardId: string,
  error?: string
): CardStatus {
  return {
    cardId,
    source,
    status: "unknown",
    lastUpdated: new Date().toISOString(),
    error,
  };
}

/** Fetch /api/cards?probe=true from the examples dashboard and normalise rows. */
export async function probeSingle(
  baseUrl: string,
  source: "examples" | "herdr",
  timeoutMs: number
): Promise<CardStatus[]> {
  const base = baseUrl.replace(/\/$/, "");
  if (source === "herdr") return probeHerdrHealth(base, timeoutMs);

  const cardsUrl = `${base}/api/cards?probe=true`;
  try {
    const res = await fetchWithTimeout(cardsUrl, timeoutMs);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    const payload = (await res.json()) as DashboardCardsPayload;
    return cardsPayloadToStatuses(payload, "examples");
  } catch (error) {
    return [
      unknownRow("examples", "examples-dashboard", `GET ${cardsUrl}: ${messageFromError(error)}`),
    ];
  }
}

async function probeHerdrHealth(baseUrl: string, timeoutMs: number): Promise<CardStatus[]> {
  const healthUrl = `${baseUrl}/api/health`;
  try {
    const res = await fetchWithTimeout(healthUrl, timeoutMs);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    const payload = (await res.json()) as {
      ok?: boolean;
      fetchedAt?: string;
      checks?: Record<string, { status?: string; message?: string }>;
    };
    const fetchedAt = payload.fetchedAt ?? new Date().toISOString();
    const checks = payload.checks ?? {};
    const rows = Object.entries(checks).map(([name, check]) => ({
      cardId: `herdr-${name}`,
      source: "herdr" as const,
      status: dashboardStatusToProbe(check.status ?? "unknown"),
      lastUpdated: fetchedAt,
      error: check.status === "error" ? check.message : undefined,
    }));
    if (rows.length > 0) return rows;
    return [
      {
        cardId: "herdr-dashboard",
        source: "herdr",
        status: payload.ok === true ? "pass" : "fail",
        lastUpdated: fetchedAt,
      },
    ];
  } catch (error) {
    return [unknownRow("herdr", "herdr-dashboard", `GET ${healthUrl}: ${messageFromError(error)}`)];
  }
}

function messageFromError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "request timed out";
    return error.message;
  }
  return Bun.inspect(error);
}

function unreachableMessage(source: "examples" | "herdr", config: CardProbeConfig): string {
  if (source === "examples") {
    const explicit = config.examplesDashboardUrl?.trim();
    if (explicit) {
      return `Cannot reach EXAMPLES_DASHBOARD_URL (${explicit}) — is the dev server running?`;
    }
    return `No examples dashboard on ports ${EXAMPLES_PORTS.join(", ")} — set EXAMPLES_DASHBOARD_URL or run \`bun run dev\``;
  }
  const explicit = config.herdrDashboardUrl?.trim() || (Bun.env.HERDR_DASHBOARD_URL ?? "").trim();
  if (explicit) {
    return `Cannot reach HERDR_DASHBOARD_URL (${explicit}) — is Herdr running?`;
  }
  return `No Herdr dashboard on port ${HERDR_PORTS.join(", ")} — set HERDR_DASHBOARD_URL or start Herdr`;
}

export function summarizeCardStatuses(statuses: CardStatus[]): {
  total: number;
  pass: number;
  fail: number;
  unknown: number;
} {
  let pass = 0;
  let fail = 0;
  let unknown = 0;
  for (const row of statuses) {
    if (row.status === "pass") pass++;
    else if (row.status === "unknown" || row.status === "pending") unknown++;
    else fail++;
  }
  return { total: statuses.length, pass, fail, unknown };
}

/** Snapshot served by `kimi-doctor --serve-probe`. */
export interface ProbeServerSnapshot {
  fetchedAt: string;
  statuses: CardStatus[];
  ok: boolean;
}

/** Count cards that are not passing. */
export function countUnhealthy(statuses: CardStatus[]): number {
  return statuses.filter((s) => s.status !== "pass").length;
}

/** Probe examples + Herdr dashboards concurrently. */
export async function probeAllCards(config: CardProbeConfig = {}): Promise<CardStatus[]> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const [examplesBase, herdrBase] = await Promise.all([
    resolveExamplesBaseUrl({ ...config, timeoutMs }),
    resolveHerdrBaseUrl({ ...config, timeoutMs }),
  ]);

  const [examples, herdr] = await Promise.all([
    examplesBase
      ? probeSingle(examplesBase, "examples", timeoutMs)
      : Promise.resolve([
          unknownRow("examples", "examples-dashboard", unreachableMessage("examples", config)),
        ]),
    herdrBase
      ? probeSingle(herdrBase, "herdr", timeoutMs)
      : Promise.resolve([
          unknownRow("herdr", "herdr-dashboard", unreachableMessage("herdr", config)),
        ]),
  ]);

  return [...examples, ...herdr];
}

export function formatCardProbeTable(statuses: CardStatus[]): string {
  return Bun.inspect.table(statuses, ["cardId", "source", "status", "lastUpdated"], {
    colors: true,
  });
}
