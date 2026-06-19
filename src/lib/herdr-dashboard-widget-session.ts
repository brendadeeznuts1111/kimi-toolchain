/**
 * herdr-dashboard-widget-session.ts — Session catalog lookup for dashboard widgets.
 */

import type { DashboardMetaDiscovery } from "./herdr-dashboard-discovery-meta.ts";
import type { DashboardSessionCatalogEntry } from "./herdr-dashboard-sessions.ts";

export function dashboardWidgetSessionLabel(session: string): string {
  const trimmed = session.trim();
  return trimmed.length > 0 ? trimmed : "primary";
}

export function findDashboardWidgetSessionEntry(
  session: string,
  catalog: DashboardMetaDiscovery["sessionCatalog"] | undefined
): DashboardSessionCatalogEntry | null {
  const normalized = session.trim();
  if (!catalog?.length) {
    return normalized === ""
      ? { session: "", label: "primary", host: "(local)", reachable: true }
      : null;
  }
  const entry = catalog.find((row) => row.session.trim() === normalized);
  if (!entry) return null;
  return {
    session: entry.session.trim(),
    label: entry.label,
    host: entry.host,
    reachable: entry.reachable,
    ...(entry.error ? { error: entry.error } : {}),
  };
}

export function resolveDashboardWidgetSession(
  session: string,
  catalog: DashboardMetaDiscovery["sessionCatalog"] | undefined
): { ok: true; entry: DashboardSessionCatalogEntry } | { ok: false; error: string } {
  const entry = findDashboardWidgetSessionEntry(session, catalog);
  if (!entry) {
    return { ok: false, error: "session not in catalog" };
  }
  if (!entry.reachable) {
    return {
      ok: false,
      error: entry.error ?? `session "${dashboardWidgetSessionLabel(session)}" unreachable`,
    };
  }
  return { ok: true, entry };
}
