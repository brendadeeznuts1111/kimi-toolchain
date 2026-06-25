/**
 * herdr-dashboard/session-selector.ts — Session selector visibility (mirrors templates/herdr-dashboard.js).
 */

import type { DashboardMetaDiscovery } from "./discovery/meta.ts";

export const SESSION_ALL = "__all__";

export function normalizeDashboardSession(session: unknown): string {
  return String(session ?? "").trim();
}

export function sessionIdsFromDiscovery(
  discovery: Pick<DashboardMetaDiscovery, "sessionsAvailable"> | undefined,
  agentSessions: readonly string[] = []
): string[] {
  const fromMeta = discovery?.sessionsAvailable;
  if (Array.isArray(fromMeta) && fromMeta.length > 0) {
    return fromMeta.map((id) => normalizeDashboardSession(id));
  }
  const seen = new Set<string>();
  for (const row of agentSessions) seen.add(normalizeDashboardSession(row));
  return [...seen].sort((a, b) => {
    if (a === "") return -1;
    if (b === "") return 1;
    return a.localeCompare(b);
  });
}

/** Whether the session <select> should offer more than one scope. */
export function shouldShowDashboardSessionSelector(
  discovery: Pick<DashboardMetaDiscovery, "multiSessionEnabled" | "sessionsAvailable"> | undefined,
  agentSessions: readonly string[] = []
): boolean {
  if (discovery?.multiSessionEnabled) return true;
  const sessions = sessionIdsFromDiscovery(discovery, agentSessions);
  return sessions.length > 1 || (sessions.length === 1 && sessions[0] !== "");
}
