/**
 * examples-dashboard-webview-probe.ts — Bun.WebView metadata reader for examples/dashboard.
 *
 * Navigates the live dashboard, scrolls lazy lanes into view, scrapes DOM card state,
 * and diffs against GET /api/cards?probe=true.
 */

import type { DashboardCardStatus, DashboardCardsPayload } from "./dashboard-card-registry.ts";
import { ensureExamplesDashboardCompanion } from "./examples-dashboard-companion.ts";
import { buildDashboardWebViewOptions } from "./herdr-dashboard-webview-options.ts";
import {
  createWebViewConsoleCollector,
  waitForNavigation,
  webViewSupported,
  type WebViewConsoleEvent,
} from "./webview-console.ts";

export const EXAMPLES_DASHBOARD_TITLE = "kimi-toolchain Dashboard";
export const EXAMPLES_DASHBOARD_READY_EVAL = "Boolean(window.__EXAMPLES_DASHBOARD_READY__)";

export interface ExamplesDashboardLandingStat {
  value: string | null;
  label: string | null;
  sub: string | null;
  detail: string | null;
  stale: boolean;
}

export interface ExamplesDashboardCardDomRow {
  id: string;
  title: string | null;
  liveClass: "ok" | "warn" | "error" | "unknown";
  cardLiveStatus: string | null;
  loading: boolean;
  hasError: boolean;
  snippet: string;
}

export interface ExamplesDashboardDomMetadata {
  title: string;
  url: string;
  ready: boolean;
  cardCount: number;
  loadingCards: number;
  errorCards: number;
  cards: ExamplesDashboardCardDomRow[];
  landing: Record<string, ExamplesDashboardLandingStat>;
}

export interface ExamplesDashboardCardMismatch {
  id: string;
  apiStatus: DashboardCardStatus;
  domLiveClass: ExamplesDashboardCardDomRow["liveClass"];
  domLoading: boolean;
  reason: string;
}

export interface ExamplesDashboardWebViewProbeResult {
  ok: boolean;
  url: string;
  title: string;
  ready: boolean;
  fetchedAt: string;
  api: DashboardCardsPayload | null;
  dom: ExamplesDashboardDomMetadata | null;
  consoleEvents: WebViewConsoleEvent[];
  mismatches: ExamplesDashboardCardMismatch[];
  failingApiCards: Array<{ id: string; status: DashboardCardStatus; apiRoute: string | null }>;
  summary: {
    apiOk: number;
    apiTotal: number;
    domLoading: number;
    domErrors: number;
    mismatchCount: number;
  };
  error?: string;
}

export interface ProbeExamplesDashboardWebViewOptions {
  projectRoot: string;
  port?: number;
  /** Wait for lazy lanes + landing refresh (default 12s). */
  settleMs?: number;
  /** Poll interval while waiting for ready flag (default 250ms). */
  pollMs?: number;
  /** Navigation timeout (default 15s). */
  navTimeoutMs?: number;
  /** When true, keep the WebView open until ctrl+c (debug). */
  interactive?: boolean;
  width?: number;
  height?: number;
}

/** In-page script — keep JSON-serializable; no closures from Bun side. */
export function buildExamplesDashboardMetadataEval(): string {
  return `(() => {
    const liveClass = (el) =>
      el.classList.contains("live-ok")
        ? "ok"
        : el.classList.contains("live-warn")
          ? "warn"
          : el.classList.contains("live-error")
            ? "error"
            : "unknown";

    const cards = [...document.querySelectorAll("[id^='card-']")].map((el) => {
      const body = el.querySelector("div:not(.loading)");
      const text = (body?.textContent ?? "").replace(/\\s+/g, " ").trim();
      return {
        id: el.id,
        title: el.querySelector("h2")?.textContent?.trim() ?? null,
        liveClass: liveClass(el),
        cardLiveStatus: el.querySelector(".card-live-status")?.textContent?.trim() ?? null,
        loading: !!el.querySelector(".loading"),
        hasError: !!el.querySelector(".status.err, .badge-err"),
        snippet: text.slice(0, 160),
      };
    });

    const landing = {};
    for (const stat of document.querySelectorAll("[data-stat]")) {
      const id = stat.getAttribute("data-stat");
      if (!id) continue;
      landing[id] = {
        value: stat.querySelector(".value")?.textContent?.trim() ?? null,
        label: stat.querySelector(".label")?.textContent?.trim() ?? null,
        sub: stat.querySelector(".sub")?.textContent?.trim() ?? null,
        detail: stat.querySelector(".detail")?.textContent?.trim() ?? null,
        stale: stat.classList.contains("stale"),
      };
    }

    return {
      title: document.title,
      url: location.href,
      ready: Boolean(window.__EXAMPLES_DASHBOARD_READY__),
      cardCount: cards.length,
      loadingCards: cards.filter((c) => c.loading).length,
      errorCards: cards.filter((c) => c.hasError || c.liveClass === "error").length,
      cards,
      landing,
    };
  })()`;
}

/** Scroll lazy lanes into view so IntersectionObserver fires loaders. */
export const EXAMPLES_DASHBOARD_SCROLL_LANES_EVAL = `(() => {
  const seen = new Set();
  for (const el of document.querySelectorAll("[id^='card-']")) {
    if (seen.has(el.id)) continue;
    seen.add(el.id);
    el.scrollIntoView({ block: "nearest" });
  }
  window.scrollTo(0, document.body.scrollHeight);
  return document.querySelectorAll("[id^='card-']").length;
})()`;

function domClassToStatus(
  liveClass: ExamplesDashboardCardDomRow["liveClass"]
): DashboardCardStatus {
  if (liveClass === "ok") return "ok";
  if (liveClass === "warn") return "warn";
  if (liveClass === "error") return "error";
  return "unknown";
}

/** Compare API probe rows with live DOM borders / error markers. */
export function diffExamplesDashboardProbe(
  api: DashboardCardsPayload,
  dom: ExamplesDashboardDomMetadata
): ExamplesDashboardCardMismatch[] {
  const domById = new Map(dom.cards.map((row) => [row.id, row]));
  const mismatches: ExamplesDashboardCardMismatch[] = [];

  for (const card of api.cards) {
    const row = domById.get(card.id);
    if (!row) {
      mismatches.push({
        id: card.id,
        apiStatus: card.status,
        domLiveClass: "unknown",
        domLoading: true,
        reason: "card id missing from DOM",
      });
      continue;
    }

    const domStatus = domClassToStatus(row.liveClass);
    if (row.loading && card.status !== "unknown") {
      mismatches.push({
        id: card.id,
        apiStatus: card.status,
        domLiveClass: row.liveClass,
        domLoading: true,
        reason: "DOM still loading while API has status",
      });
      continue;
    }

    if (
      card.status !== "unknown" &&
      domStatus !== "unknown" &&
      card.status !== domStatus &&
      !(card.status === "warn" && domStatus === "error")
    ) {
      mismatches.push({
        id: card.id,
        apiStatus: card.status,
        domLiveClass: row.liveClass,
        domLoading: row.loading,
        reason: `API ${card.status} vs DOM ${domStatus}`,
      });
    }
  }

  return mismatches;
}

async function fetchApiCardsProbe(
  baseUrl: string,
  timeoutMs: number
): Promise<DashboardCardsPayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/cards?probe=true`, {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GET /api/cards?probe=true → HTTP ${res.status}`);
    return (await res.json()) as DashboardCardsPayload;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForExamplesDashboardReady(
  view: Bun.WebView,
  opts: { timeoutMs: number; pollMs: number }
): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    const ready = await view.evaluate(EXAMPLES_DASHBOARD_READY_EVAL);
    if (ready === true) return true;
    await view.evaluate(EXAMPLES_DASHBOARD_SCROLL_LANES_EVAL);
    await Bun.sleep(opts.pollMs);
  }
  return false;
}

function summarizeProbe(
  api: DashboardCardsPayload | null,
  dom: ExamplesDashboardDomMetadata | null,
  mismatches: ExamplesDashboardCardMismatch[]
): ExamplesDashboardWebViewProbeResult["summary"] {
  const apiCards = api?.cards ?? [];
  return {
    apiOk: apiCards.filter((c) => c.status === "ok").length,
    apiTotal: api?.total ?? apiCards.length,
    domLoading: dom?.loadingCards ?? 0,
    domErrors: dom?.errorCards ?? 0,
    mismatchCount: mismatches.length,
  };
}

/** Headless Bun.WebView pass — DOM metadata + API probe diff. */
export async function probeExamplesDashboardWebView(
  options: ProbeExamplesDashboardWebViewOptions
): Promise<ExamplesDashboardWebViewProbeResult> {
  const fetchedAt = new Date().toISOString();
  if (!webViewSupported()) {
    return {
      ok: false,
      url: "",
      title: "",
      ready: false,
      fetchedAt,
      api: null,
      dom: null,
      consoleEvents: [],
      mismatches: [],
      failingApiCards: [],
      summary: summarizeProbe(null, null, []),
      error: "Bun.WebView is not available in this runtime",
    };
  }

  const { resolveDashboardStartupPort } = await import("./dashboard-settings.ts");
  const { port: resolvedPort } = await resolveDashboardStartupPort(options.projectRoot);
  const port = options.port ?? (Number(Bun.env.PORT) || resolvedPort);
  const baseUrl = `http://127.0.0.1:${port}/`;

  const companion = await ensureExamplesDashboardCompanion(options.projectRoot, {
    url: baseUrl,
    autoStart: true,
  });

  const api = await fetchApiCardsProbe(companion.url, 30_000).catch(() => null);
  const collector = createWebViewConsoleCollector();
  const { constructorOptions } = buildDashboardWebViewOptions(companion.url, {
    width: options.width ?? 1400,
    height: options.height ?? 900,
    warn: () => {},
    console: collector.handler,
  });

  const settleMs = options.settleMs ?? 12_000;
  const pollMs = options.pollMs ?? 250;
  const navTimeoutMs = options.navTimeoutMs ?? 15_000;

  await using view = new Bun.WebView(constructorOptions);

  // constructorOptions.url auto-navigates — do not call navigate() again.
  if (view.loading) {
    try {
      await waitForNavigation(view, navTimeoutMs);
    } catch {
      /* partial DOM still useful */
    }
  }

  await waitForExamplesDashboardReady(view, { timeoutMs: settleMs, pollMs });
  await view.evaluate(EXAMPLES_DASHBOARD_SCROLL_LANES_EVAL);
  await Bun.sleep(Math.min(settleMs, 4_000));

  const dom = (await view.evaluate(
    buildExamplesDashboardMetadataEval()
  )) as ExamplesDashboardDomMetadata;
  const consoleEvents = collector.drain();
  const mismatches = api ? diffExamplesDashboardProbe(api, dom) : [];
  const failingApiCards =
    api?.cards
      .filter((c) => c.status !== "ok")
      .map((c) => ({ id: c.id, status: c.status, apiRoute: c.apiRoute })) ?? [];

  if (options.interactive) {
    process.stderr.write(
      `[dashboard] probe interactive — ${view.url} (${failingApiCards.length} api failures, ${mismatches.length} mismatches)\n`
    );
    while (true) await Bun.sleep(60_000);
  }

  return {
    ok: failingApiCards.length === 0 && mismatches.length === 0,
    url: view.url,
    title: String(view.title || dom.title || ""),
    ready: dom.ready === true,
    fetchedAt,
    api,
    dom,
    consoleEvents,
    mismatches,
    failingApiCards,
    summary: summarizeProbe(api, dom, mismatches),
    ...(api === null ? { error: "GET /api/cards?probe=true failed" } : {}),
  };
}

/** Human-readable probe report for CLI. */
export function formatExamplesDashboardProbeReport(
  result: ExamplesDashboardWebViewProbeResult
): string {
  const lines: string[] = [];
  lines.push(
    `examples dashboard webview probe — ${result.summary.apiOk}/${result.summary.apiTotal} api ok · ${result.summary.domLoading} dom loading · ${result.summary.mismatchCount} mismatches`
  );
  if (result.error) lines.push(`error: ${result.error}`);
  if (result.failingApiCards.length > 0) {
    lines.push("failing api cards:");
    for (const row of result.failingApiCards) {
      lines.push(`  ${row.id} ${row.status} ${row.apiRoute ?? ""}`.trimEnd());
    }
  }
  if (result.mismatches.length > 0) {
    lines.push("api/dom mismatches:");
    for (const row of result.mismatches.slice(0, 20)) {
      lines.push(`  ${row.id}: ${row.reason}`);
    }
    if (result.mismatches.length > 20) {
      lines.push(`  … +${result.mismatches.length - 20} more`);
    }
  }
  const consoleErrors = result.consoleEvents.filter((e) => e.type === "error");
  if (consoleErrors.length > 0) {
    lines.push(`console errors (${consoleErrors.length}):`);
    for (const event of consoleErrors.slice(0, 5)) {
      lines.push(`  ${event.args.map((a) => Bun.inspect(a, { colors: false })).join(" ")}`);
    }
  }
  if (result.dom?.landing?.cards) {
    const cards = result.dom.landing.cards;
    lines.push(`landing cards tile: ${cards.value ?? "—"} ${cards.sub ?? ""}`.trim());
  }
  return lines.join("\n");
}
