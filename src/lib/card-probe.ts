/**
 * Live card status probes — CLI + cross-dashboard orchestration.
 * SSOT types for card health; implementation delegates to /api/cards and /api/health.
 */

import type { DashboardCardStatus, DashboardCardsPayload } from "./dashboard-card-registry.ts";
import { auditConfigLayersStatus } from "./config-status.ts";
import { formatTable } from "./inspect.ts";

export interface CardProbeConfig {
  examplesDashboardUrl?: string;
  herdrDashboardUrl?: string;
  timeoutMs?: number;
}

export interface ProbeEnvironment {
  herdrActive: boolean;
  examplesExpected: boolean;
  herdrExpected: boolean;
  ci: boolean;
  context: "idle" | "dev" | "ci" | "herdr";
}

export function detectProbeEnvironment(config: CardProbeConfig = {}): ProbeEnvironment {
  const herdrActive = Bun.env.HERDR_ENV === "1";
  const ci = Bun.env.CI === "true" || Bun.env.GITHUB_ACTIONS === "true";
  const examplesExplicit = !!(
    config.examplesDashboardUrl?.trim() || Bun.env.EXAMPLES_DASHBOARD_URL?.trim()
  );
  const herdrExplicit = !!(config.herdrDashboardUrl?.trim() || Bun.env.HERDR_DASHBOARD_URL?.trim());

  const examplesExpected = examplesExplicit;
  const herdrExpected = herdrExplicit || herdrActive;

  let context: ProbeEnvironment["context"] = "idle";
  if (ci) context = "ci";
  else if (herdrActive) context = "herdr";
  else if (examplesExpected) context = "dev";

  return { herdrActive, examplesExpected, herdrExpected, ci, context };
}

export interface CardStatus {
  cardId: string;
  source: "examples" | "herdr" | "config-status";
  status: "pass" | "fail" | "pending" | "skip";
  lastUpdated: string;
  artifactUrl?: string;
  error?: string;
  reason?: string;
  startHint?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
/** Examples dashboard ports — canonical 5678 first, 3000/8080 retained as legacy fallback. */
export const CARD_PROBE_DECLARED_PORTS = {
  examples: [5678, 3000, 8080],
  herdr: [18412],
} as const;

const EXAMPLES_PORTS = CARD_PROBE_DECLARED_PORTS.examples;
const HERDR_PORTS = CARD_PROBE_DECLARED_PORTS.herdr;

export function displayCardId(id: string): string {
  return id.startsWith("card-") ? id.slice("card-".length) : id;
}

export function dashboardStatusToProbe(status: DashboardCardStatus | string): CardStatus["status"] {
  if (status === "ok") return "pass";
  if (status === "unknown" || status === "pending") return "skip";
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

function skipRow(
  source: "examples" | "herdr" | "config-status",
  cardId: string,
  reason: string,
  startHint?: string
): CardStatus {
  return {
    cardId,
    source,
    status: "skip",
    lastUpdated: new Date().toISOString(),
    reason,
    startHint,
  };
}

function failRow(
  source: "examples" | "herdr" | "config-status",
  cardId: string,
  error: string,
  reason: string,
  startHint?: string
): CardStatus {
  return {
    cardId,
    source,
    status: "fail",
    lastUpdated: new Date().toISOString(),
    error,
    reason,
    startHint,
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
      failRow(
        "examples",
        "examples-dashboard",
        `GET ${cardsUrl}: ${messageFromError(error)}`,
        "Examples dashboard is expected but unreachable",
        "Check that the dev server is running: bun run dev"
      ),
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
    return [
      failRow(
        "herdr",
        "herdr-dashboard",
        `GET ${healthUrl}: ${messageFromError(error)}`,
        "Herdr dashboard is expected but unreachable",
        "Check that Herdr is running (HERDR_ENV=1)"
      ),
    ];
  }
}

function messageFromError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "request timed out";
    return error.message;
  }
  return Bun.inspect(error);
}

export function cardProbeUnreachableMessage(
  source: "examples" | "herdr" | "config-status",
  config: CardProbeConfig
): string {
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
  skip: number;
} {
  let pass = 0;
  let fail = 0;
  let skip = 0;
  for (const row of statuses) {
    if (row.status === "pass") pass++;
    else if (row.status === "skip" || row.status === "pending") skip++;
    else fail++;
  }
  return { total: statuses.length, pass, fail, skip };
}

/** Snapshot served by `kimi-doctor --serve-probe`. */
export interface ProbeServerSnapshot {
  fetchedAt: string;
  statuses: CardStatus[];
  ok: boolean;
}

/** Count cards that are not passing (skip is considered healthy). */
export function countUnhealthy(statuses: CardStatus[]): number {
  return statuses.filter((s) => s.status !== "pass" && s.status !== "skip").length;
}

/** Probe local configuration layers and return a card row. */
export async function probeConfigStatusCard(
  projectRoot: string = process.cwd()
): Promise<CardStatus> {
  try {
    const report = await auditConfigLayersStatus(projectRoot, { withScaffold: false });
    return {
      cardId: "config-status",
      source: "config-status",
      status: report.aligned ? "pass" : "fail",
      lastUpdated: new Date().toISOString(),
      error: report.aligned
        ? undefined
        : `failed: ${report.gates
            .filter((gate) => gate.status === "fail")
            .map((gate) => gate.id)
            .join(", ")}`,
    };
  } catch (error) {
    return {
      cardId: "config-status",
      source: "config-status",
      status: "fail",
      lastUpdated: new Date().toISOString(),
      error: messageFromError(error),
    };
  }
}

/** Probe examples + Herdr dashboards concurrently, skipping sources not expected in this environment. */
export async function probeAllCards(
  config: CardProbeConfig = {},
  projectRoot?: string
): Promise<CardStatus[]> {
  const env = detectProbeEnvironment(config);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const examplesPromise: Promise<CardStatus[]> = env.examplesExpected
    ? (async () => {
        const base = await resolveExamplesBaseUrl({ ...config, timeoutMs });
        return base
          ? probeSingle(base, "examples", timeoutMs)
          : [
              failRow(
                "examples",
                "examples-dashboard",
                cardProbeUnreachableMessage("examples", config),
                "EXAMPLES_DASHBOARD_URL is set but the server is not responding",
                "Start the dev server: bun run dev"
              ),
            ];
      })()
    : Promise.resolve([
        skipRow(
          "examples",
          "examples-dashboard",
          "Examples dashboard not expected (EXAMPLES_DASHBOARD_URL not set)",
          "Set EXAMPLES_DASHBOARD_URL or run `bun run dev`"
        ),
      ]);

  const herdrPromise: Promise<CardStatus[]> = env.herdrExpected
    ? (async () => {
        const base = await resolveHerdrBaseUrl({ ...config, timeoutMs });
        return base
          ? probeSingle(base, "herdr", timeoutMs)
          : [
              failRow(
                "herdr",
                "herdr-dashboard",
                cardProbeUnreachableMessage("herdr", config),
                "Herdr dashboard is expected but the server is not responding",
                "Start Herdr or check HERDR_DASHBOARD_URL"
              ),
            ];
      })()
    : Promise.resolve([
        skipRow(
          "herdr",
          "herdr-dashboard",
          `Herdr not active (HERDR_ENV not set, context: ${env.context})`,
          "Set HERDR_ENV=1 or HERDR_DASHBOARD_URL to enable"
        ),
      ]);

  const [examples, herdr, configStatusCard] = await Promise.all([
    examplesPromise,
    herdrPromise,
    probeConfigStatusCard(projectRoot ?? process.cwd()),
  ]);

  return [...examples, ...herdr, configStatusCard];
}

export function formatCardProbeTable(statuses: CardStatus[]): string {
  const hasReasons = statuses.some((s) => s.reason);
  const columns: (keyof CardStatus)[] = hasReasons
    ? ["cardId", "source", "status", "reason", "lastUpdated"]
    : ["cardId", "source", "status", "lastUpdated"];
  return formatTable(statuses as unknown as Record<string, unknown>[], columns as string[], {
    colors: true,
  });
}
