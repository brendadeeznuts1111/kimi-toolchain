/**
 * Pre-compiled URLPattern routes for artifact / run dashboard APIs.
 *
 * Patterns are module singletons so Bun reuses the compiled regex engine across requests.
 * @see https://bun.com/blog/bun-v1.3.12 — URLPattern.test/exec performance
 */

/** Decode a pathname capture group (handles `%2F` etc.). */
export function decodePathParam(value: string): string {
  return decodeURIComponent(value);
}

/** Read a named pathname group from a URLPattern exec result. */
export function pathnameGroup(match: URLPatternResult | null, key: string): string | undefined {
  const raw = match?.pathname.groups[key];
  if (raw === undefined) return undefined;
  return decodePathParam(raw);
}

// ── Herdr / examples dashboard artifact nervous system ─────────────────

export const DASHBOARD_RUN_MANIFEST = new URLPattern({ pathname: "/api/runs/:runId" });
export const DASHBOARD_SESSION_RUNS = new URLPattern({ pathname: "/api/sessions/:scope/runs" });
export const DASHBOARD_SESSION_ARTIFACTS = new URLPattern({
  pathname: "/api/sessions/:scope/artifacts",
});
export const DASHBOARD_ARTIFACT_INDEX_STATS = new URLPattern({
  pathname: "/api/artifacts/index/stats",
});
export const DASHBOARD_ARTIFACT_FEED = new URLPattern({
  pathname: "/api/artifacts/feed.xml",
});
export const DASHBOARD_ARTIFACT_LINEAGE = new URLPattern({
  pathname: "/api/artifacts/:gate/lineage",
});
/** Governance diff endpoint (`?a=&b=` relative artifact paths). */
export const DASHBOARD_ARTIFACT_DIFF = new URLPattern({
  pathname: "/api/artifacts/:gate/diff",
});

const DASHBOARD_ARTIFACT_SUBPATH = new URLPattern({ pathname: "/api/artifacts/*" });
const DASHBOARD_RUN_SUBPATH = new URLPattern({ pathname: "/api/runs/*" });
const DASHBOARD_SESSION_SUBPATH = new URLPattern({ pathname: "/api/sessions/*" });

/** True when pathname is under read-only artifact / run / session namespaces. */
export function isDashboardArtifactNamespace(pathname: string): boolean {
  return (
    pathname === "/api/artifacts" ||
    pathname === "/api/runs" ||
    pathname === "/api/sessions" ||
    DASHBOARD_ARTIFACT_SUBPATH.test({ pathname }) ||
    DASHBOARD_RUN_SUBPATH.test({ pathname }) ||
    DASHBOARD_SESSION_SUBPATH.test({ pathname })
  );
}

// ── serve-probe card artifact inspection ───────────────────────────────

export const PROBE_ARTIFACTS_REFRESH = new URLPattern({
  pathname: "/api/artifacts/:gate/refresh",
});
export const PROBE_ARTIFACTS_LATEST = new URLPattern({
  pathname: "/api/artifacts/:gate/latest",
});
export const PROBE_ARTIFACTS_GATE = new URLPattern({ pathname: "/api/artifacts/:gate" });
export const PROBE_ARTIFACTS_ROOT = new URLPattern({ pathname: "/api/artifacts" });

export interface ProbeArtifactsRouteMatch {
  gateName: string | undefined;
  segment: "latest" | "refresh" | undefined;
}

/** Resolve serve-probe artifact sub-routes (most specific pattern first). */
export function matchProbeArtifactsRoute(url: URL): ProbeArtifactsRouteMatch | null {
  const refresh = PROBE_ARTIFACTS_REFRESH.exec(url);
  if (refresh) {
    return { gateName: pathnameGroup(refresh, "gate"), segment: "refresh" };
  }
  const latest = PROBE_ARTIFACTS_LATEST.exec(url);
  if (latest) {
    return { gateName: pathnameGroup(latest, "gate"), segment: "latest" };
  }
  const gate = PROBE_ARTIFACTS_GATE.exec(url);
  if (gate) {
    return { gateName: pathnameGroup(gate, "gate"), segment: undefined };
  }
  if (PROBE_ARTIFACTS_ROOT.test(url)) {
    return { gateName: undefined, segment: undefined };
  }
  return null;
}
