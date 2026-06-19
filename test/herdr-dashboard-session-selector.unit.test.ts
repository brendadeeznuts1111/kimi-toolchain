import { describe, expect, test } from "bun:test";
import { buildDashboardMetaDiscovery } from "../src/lib/herdr-dashboard-discovery-meta.ts";
import { finalizeSessionCatalog } from "../src/lib/herdr-dashboard-sessions.ts";
import {
  sessionIdsFromDiscovery,
  shouldShowDashboardSessionSelector,
} from "../src/lib/herdr-dashboard-session-selector.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("herdr-dashboard-session-selector", () => {
  test("sessions off: sessionsAvailable is primary id and selector hidden", () => {
    const discovery = buildDashboardMetaDiscovery(REPO_ROOT, { sessions: false });
    expect(discovery.sessionsAvailable).toEqual([""]);
    expect(discovery.sessionCatalog[0]?.label).toBe("primary");
    expect(discovery.multiSessionEnabled).toBe(false);
    expect(shouldShowDashboardSessionSelector(discovery, [])).toBe(false);
    expect(sessionIdsFromDiscovery(discovery, [])).toEqual([""]);
  });

  test("sessions on: selector visible even before agent rows load", () => {
    const catalog = finalizeSessionCatalog([
      { session: "", label: "primary", host: "(local)", reachable: true },
      {
        session: "staging",
        label: "staging",
        host: "staging",
        reachable: false,
        error: "not running",
      },
    ]);
    const discovery = buildDashboardMetaDiscovery(
      REPO_ROOT,
      { sessions: true },
      undefined,
      catalog
    );
    expect(discovery.multiSessionEnabled).toBe(true);
    expect(discovery.sessionsAvailable).toEqual(["", "staging"]);
    expect(shouldShowDashboardSessionSelector(discovery, [])).toBe(true);
    expect(sessionIdsFromDiscovery(discovery, [])).toEqual(["", "staging"]);
    expect(discovery.sessionCatalog.find((row) => row.session === "staging")?.reachable).toBe(
      false
    );
  });

  test("sessions on with only primary in catalog still shows selector", () => {
    const catalog = finalizeSessionCatalog([
      { session: "", label: "primary", host: "(local)", reachable: true },
    ]);
    const discovery = buildDashboardMetaDiscovery(
      REPO_ROOT,
      { sessions: true },
      undefined,
      catalog
    );
    expect(discovery.sessionsAvailable).toEqual([""]);
    expect(shouldShowDashboardSessionSelector(discovery, [])).toBe(true);
  });
});
