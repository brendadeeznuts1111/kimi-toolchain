import { describe, expect, test } from "bun:test";
import { buildDashboardMetaDiscovery } from "../src/lib/herdr-dashboard-discovery-meta.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("herdr-dashboard-discovery-meta", () => {
  test("buildDashboardMetaDiscovery reads kimi-toolchain primary session", () => {
    const discovery = buildDashboardMetaDiscovery(REPO_ROOT);
    expect(discovery.herdrSession).toBe("");
    expect(discovery.herdrSessionLabel).toBe("primary");
    expect(discovery.mode).toBe("workspace");
    expect(discovery.workspaceLabel).toBe("kimi-toolchain");
    expect(discovery.multiSessionEnabled).toBe(false);
    expect(discovery.remoteHostsConfigured).toBeGreaterThanOrEqual(1);
    expect(discovery.remoteHosts.configured).toBe(discovery.remoteHostsConfigured);
    expect(discovery.remoteHosts.reachable).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(discovery.remoteHosts.hosts)).toBe(true);
    expect(discovery.workspaceCandidateCount).toBeGreaterThanOrEqual(0);
    expect(
      ["none", "single", "focused_cwd", "cwd", "pane_count", "lexicographic"].includes(
        discovery.workspaceIdResolution
      )
    ).toBe(true);
    if (discovery.workspaceId) {
      expect(discovery.workspaceId.length).toBeGreaterThan(0);
    }
    if (discovery.workspaceIdResolution === "single") {
      expect(discovery.workspaceCandidateCount).toBe(1);
    }
    if (discovery.workspaceIdResolution === "none") {
      expect(discovery.workspaceCandidateCount).toBe(0);
    }
    expect(discovery.sessionsAvailable).toEqual([""]);
    expect(discovery.sessionCatalog[0]?.label).toBe("primary");
  });

  test("buildDashboardMetaDiscovery uses sessions mode when flag set", () => {
    const discovery = buildDashboardMetaDiscovery(REPO_ROOT, { sessions: true });
    expect(discovery.mode).toBe("sessions");
    expect(discovery.multiSessionEnabled).toBe(true);
  });

  test("herdrSessionLabel maps named sessions", () => {
    const discovery = buildDashboardMetaDiscovery("/nonexistent-project", { sessions: false });
    expect(discovery.herdrSession).toBe("");
    expect(discovery.herdrSessionLabel).toBe("primary");
    expect(discovery.workspaceLabel).toBeNull();
    expect(discovery.workspaceId).toBeNull();
    expect(discovery.workspaceIdResolution).toBe("none");
    expect(discovery.workspaceCandidateCount).toBe(0);
    expect(discovery.remoteHostsConfigured).toBe(0);
    expect(discovery.remoteHosts).toEqual({ configured: 0, reachable: 0, hosts: [] });
    expect(discovery.sessionsAvailable).toEqual([""]);
    expect(discovery.sessionCatalog[0]?.label).toBe("primary");
    expect(discovery.multiSessionEnabled).toBe(false);
  });
});
