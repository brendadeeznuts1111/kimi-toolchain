import { describe, expect, test } from "bun:test";
import {
  DASHBOARD_ARTIFACT_DIFF,
  DASHBOARD_ARTIFACT_FEED,
  DASHBOARD_ARTIFACT_INDEX_STATS,
  DASHBOARD_ARTIFACT_LINEAGE,
  DASHBOARD_RUN_MANIFEST,
  DASHBOARD_SESSION_RUNS,
  isDashboardArtifactNamespace,
  matchProbeArtifactsRoute,
  pathnameGroup,
} from "../src/lib/dashboard-route-patterns.ts";

describe("dashboard-route-patterns", () => {
  test("DASHBOARD_RUN_MANIFEST captures runId", () => {
    const url = new URL("http://localhost/api/runs/run_dashboard_a");
    const match = DASHBOARD_RUN_MANIFEST.exec(url);
    expect(match).not.toBeNull();
    expect(pathnameGroup(match, "runId")).toBe("run_dashboard_a");
  });

  test("DASHBOARD_SESSION_RUNS captures scope", () => {
    const url = new URL("http://localhost/api/sessions/wd_dashboard_a/runs");
    const match = DASHBOARD_SESSION_RUNS.exec(url);
    expect(pathnameGroup(match, "scope")).toBe("wd_dashboard_a");
  });

  test("DASHBOARD_ARTIFACT_INDEX_STATS matches stats route", () => {
    expect(
      DASHBOARD_ARTIFACT_INDEX_STATS.test(new URL("http://localhost/api/artifacts/index/stats"))
    ).toBe(true);
  });

  test("DASHBOARD_ARTIFACT_FEED matches feed route", () => {
    expect(DASHBOARD_ARTIFACT_FEED.test(new URL("http://localhost/api/artifacts/feed.xml"))).toBe(
      true
    );
    expect(isDashboardArtifactNamespace("/api/artifacts/feed.xml")).toBe(true);
  });

  test("DASHBOARD_ARTIFACT_LINEAGE and DIFF capture gate", () => {
    const lineage = DASHBOARD_ARTIFACT_LINEAGE.exec(
      new URL("http://localhost/api/artifacts/model-drift/lineage")
    );
    expect(pathnameGroup(lineage, "gate")).toBe("model-drift");

    const diff = DASHBOARD_ARTIFACT_DIFF.exec(
      new URL("http://localhost/api/artifacts/model-drift/diff?a=1&b=2")
    );
    expect(pathnameGroup(diff, "gate")).toBe("model-drift");
  });

  test("pathnameGroup decodes encoded segments", () => {
    const match = DASHBOARD_RUN_MANIFEST.exec(new URL("http://localhost/api/runs/run%2Fnested"));
    expect(pathnameGroup(match, "runId")).toBe("run/nested");
  });

  test("isDashboardArtifactNamespace covers artifact/run/session trees", () => {
    expect(isDashboardArtifactNamespace("/api/runs")).toBe(true);
    expect(isDashboardArtifactNamespace("/api/runs/run_a")).toBe(true);
    expect(isDashboardArtifactNamespace("/api/artifacts/model-drift/lineage")).toBe(true);
    expect(isDashboardArtifactNamespace("/api/sessions/wd/runs")).toBe(true);
    expect(isDashboardArtifactNamespace("/api/agents")).toBe(false);
  });

  test("matchProbeArtifactsRoute resolves gate segments", () => {
    expect(matchProbeArtifactsRoute(new URL("http://x/api/artifacts"))).toEqual({
      gateName: undefined,
      segment: undefined,
    });
    expect(matchProbeArtifactsRoute(new URL("http://x/api/artifacts/bunfig-policy"))).toEqual({
      gateName: "bunfig-policy",
      segment: undefined,
    });
    expect(
      matchProbeArtifactsRoute(new URL("http://x/api/artifacts/bunfig-policy/latest"))
    ).toEqual({
      gateName: "bunfig-policy",
      segment: "latest",
    });
    expect(
      matchProbeArtifactsRoute(new URL("http://x/api/artifacts/bunfig-policy/refresh"))
    ).toEqual({
      gateName: "bunfig-policy",
      segment: "refresh",
    });
    expect(matchProbeArtifactsRoute(new URL("http://x/api/cards"))).toBeNull();
  });
});
