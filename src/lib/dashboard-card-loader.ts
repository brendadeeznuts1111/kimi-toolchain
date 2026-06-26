/**
 * Low-level dashboard card loading from dashboard.html/dashboard.js.
 *
 * Kept separate from dashboard-card-registry.ts so examples-showcase.ts can load
 * card ids without creating a circular import through the registry.
 */

import { join } from "path";
import { pathExists, readText } from "./bun-io.ts";

export const DASHBOARD_HTML_REL = "examples/dashboard/src/dashboard.html";
export const DASHBOARD_JS_REL = "examples/dashboard/src/dashboard.js";

export interface DashboardCardLoaderEntry {
  id: string;
  title: string;
  apiRoute: string | null;
}

export function dashboardHtmlPath(repoRoot: string): string {
  return join(repoRoot, DASHBOARD_HTML_REL);
}

export function dashboardScriptPath(repoRoot: string): string {
  return join(repoRoot, DASHBOARD_JS_REL);
}

function resolveDashboardScriptSource(repoRoot: string, html: string): string {
  const corePath = join(repoRoot, "examples/dashboard/src/dashboard-core.js");
  const jsPath = dashboardScriptPath(repoRoot);
  const parts: string[] = [];
  const loaderDir = join(repoRoot, "examples/dashboard/src/dashboard-loaders");
  if (pathExists(corePath)) parts.push(readText(corePath));
  if (pathExists(jsPath)) parts.push(readText(jsPath));
  if (pathExists(loaderDir)) {
    for (const file of [...new Bun.Glob("*.js").scanSync(loaderDir)].sort()) {
      parts.push(readText(join(loaderDir, file)));
    }
  }
  if (parts.length > 0) return parts.join("\n");
  const scriptStart = html.indexOf("<script>");
  return scriptStart >= 0 ? html.slice(scriptStart) : "";
}

/** Start index of the innermost `(async () => {` IIFE enclosing `cardIndex`. */
function findEnclosingIifeStart(script: string, cardIndex: number): number {
  const before = script.slice(0, cardIndex);
  const iifeRe = /\(async\s*\(\s*\)\s*=>\s*\{/g;
  let start = 0;
  for (const match of before.matchAll(iifeRe)) {
    start = match.index ?? 0;
  }
  return start;
}

/** First document-order fetch in a card loader block (primary probe route). */
function primaryApiRouteInBlock(block: string): string | null {
  const fetchRe = /(?:fetchJson|fetch)\("(\/api\/[^"]+)"\)/g;
  const matches = [...block.matchAll(fetchRe)].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return matches[0]?.[1] ?? null;
}

function inferApiRoute(cardId: string): string | null {
  const overrides: Record<string, string> = {
    "card-gates": "/api/gates",
    "card-depth": "/api/console-depth",
    "card-build": "/api/build-info",
    "card-dotenv": "/api/dotenv",
    "card-crypto-hash": "/api/crypto-hash",
    "card-file-io": "/api/file-io",
    "card-effect-image": "/api/effect-image",
    "card-kimi-doctor": "/api/kimi-doctor",
    "card-perf-harness": "/api/perf-harness",
    "card-perf-registry": "/api/perf-registry",
    "card-effect-benchmark": "/api/effect-benchmark",
    "card-config-status": "/api/config-status",
    "card-bun-runtime": "/api/bun-runtime",
    "card-bun-pm": "/api/bun-pm",
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
    "card-bunfig-policy": "/api/bunfig",
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
    "card-artifacts": "/api/artifacts",
    "card-convergence": "/api/artifact-graph",
    "card-markdown": "/api/markdown/html",
    "card-serve-metrics": "/api/serve-metrics",
    "card-cookies": "/api/cookies",
    "card-serve-ws": "/api/ws",
    "card-token-jwt": "/api/tokens",
    "card-token-csrf": "/api/tokens",
    "card-identity-flow": "/api/identity/flow",
  };
  if (overrides[cardId]) return overrides[cardId];
  if (!cardId.startsWith("card-")) return null;
  const slug = cardId.slice("card-".length);
  return `/api/${slug}`;
}

/** Parse `id="card-*"` panels and primary `/api/*` route from dashboard shell + script source. */
export function parseDashboardCardsFromHtml(
  html: string,
  options: { script?: string } = {}
): DashboardCardLoaderEntry[] {
  const panels: Array<{ id: string; title: string }> = [];
  const panelRe = /id="(card-[^"]+)"[^>]*>\s*<h2>([^<]*)<\/h2>/g;
  for (const match of html.matchAll(panelRe)) {
    const id = match[1];
    const title = match[2];
    if (!id || title === undefined) continue;
    if (!/^card-[\w-]+$/.test(id)) {
      throw new Error(`dashboard.html: malformed card id "${id}" — must match card-[\\w-]+`);
    }
    panels.push({ id, title: title.trim() });
  }

  const scriptStart = html.indexOf("<script>");
  const script = options.script ?? (scriptStart >= 0 ? html.slice(scriptStart) : "");
  const apiByCard = new Map<string, string>();

  for (const match of script.matchAll(/card\("(card-[^"]+)"/g)) {
    const cardId = match[1];
    if (!cardId) continue;
    const idx = match.index ?? 0;
    const iifeStart = findEnclosingIifeStart(script, idx);
    const block = script.slice(iifeStart, idx);
    const route = primaryApiRouteInBlock(block);
    if (route) apiByCard.set(cardId, route);
  }

  if (script.includes("loadEffectBenchmarkCard")) {
    apiByCard.set("card-effect-benchmark", "/api/effect-benchmark");
  }
  if (script.includes("card-artifacts-body")) {
    apiByCard.set("card-artifacts", "/api/artifacts");
  }

  return panels.map((panel) => ({
    ...panel,
    apiRoute: apiByCard.get(panel.id) ?? inferApiRoute(panel.id),
  }));
}

const _cardCache = new Map<string, DashboardCardLoaderEntry[]>();

export function loadDashboardCards(repoRoot: string): DashboardCardLoaderEntry[] {
  const cached = _cardCache.get(repoRoot);
  if (cached) return cached;
  const path = dashboardHtmlPath(repoRoot);
  const html = readText(path);
  const script = resolveDashboardScriptSource(repoRoot, html);
  const result = parseDashboardCardsFromHtml(html, { script });
  _cardCache.set(repoRoot, result);
  return result;
}

export function loadDashboardCardIds(repoRoot: string): string[] {
  return loadDashboardCards(repoRoot).map((c) => c.id);
}
