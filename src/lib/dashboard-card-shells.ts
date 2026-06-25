/**
 * Minimal dashboard.html card panel shells — generated slice between AUTO markers.
 */

import { dashboardHtmlPath, loadDashboardCards } from "./dashboard-card-registry.ts";
import { readText, writeText } from "./bun-io.ts";

export const DASHBOARD_CARD_SHELLS_BEGIN = "<!-- DASHBOARD_CARD_SHELLS:AUTO -->";
export const DASHBOARD_CARD_SHELLS_END = "<!-- /DASHBOARD_CARD_SHELLS:AUTO -->";

export function renderCardShell(id: string, title: string): string {
  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `      <div class="card" id="${id}">
        <h2>${safeTitle}</h2>
        <div class="loading">Loading…</div>
      </div>`;
}

function panelIdsFromHtml(html: string): Set<string> {
  return new Set([...html.matchAll(/id="(card-[^"]+)"/g)].map((m) => m[1]!));
}

/** Cards in registry that lack a panel — candidates for generated shells. */
export function missingCardPanels(repoRoot: string): Array<{ id: string; title: string }> {
  const cards = loadDashboardCards(repoRoot);
  const html = readText(dashboardHtmlPath(repoRoot));
  const panels = panelIdsFromHtml(html);
  return cards.filter((c) => !panels.has(c.id)).map((c) => ({ id: c.id, title: c.title }));
}

export function renderCardShellBlock(cards: Array<{ id: string; title: string }>): string {
  if (cards.length === 0) {
    return `${DASHBOARD_CARD_SHELLS_BEGIN}\n${DASHBOARD_CARD_SHELLS_END}`;
  }
  const body = cards.map((c) => renderCardShell(c.id, c.title)).join("\n");
  return `${DASHBOARD_CARD_SHELLS_BEGIN}\n${body}\n      ${DASHBOARD_CARD_SHELLS_END}`;
}

export function syncDashboardCardShells(
  repoRoot: string,
  options: { check?: boolean } = {}
): string[] {
  const violations: string[] = [];
  const missing = missingCardPanels(repoRoot);
  const htmlPath = dashboardHtmlPath(repoRoot);
  const html = readText(htmlPath);
  const expectedBlock = renderCardShellBlock(missing);

  const blockRe = new RegExp(
    `${escapeRegExp(DASHBOARD_CARD_SHELLS_BEGIN)}[\\s\\S]*?${escapeRegExp(DASHBOARD_CARD_SHELLS_END)}`
  );

  if (!blockRe.test(html)) {
    violations.push("dashboard.html missing DASHBOARD_CARD_SHELLS markers inside #card-grid");
    return violations;
  }

  const current = html.match(blockRe)?.[0];
  if (options.check) {
    if (current !== expectedBlock && missing.length > 0) {
      violations.push(
        `dashboard.html card shells stale — ${missing.length} registry panel(s) missing: ${missing.map((c) => c.id).join(", ")}`
      );
    }
    return violations;
  }

  if (current !== expectedBlock) {
    writeText(htmlPath, html.replace(blockRe, expectedBlock));
  }
  return violations;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
