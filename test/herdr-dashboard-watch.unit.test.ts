import { describe, expect, test } from "bun:test";
import { createDashboardEventBus } from "../src/lib/herdr-dashboard-bus.ts";
import type { DashboardMetaDiscovery } from "../src/lib/herdr-dashboard-discovery-meta.ts";
import {
  computeDashboardMetaGateFingerprint,
  diffRemoteHosts,
  diffSessionsAvailable,
  handleDashboardDiscoveryWatch,
  startDashboardMetaWatch,
} from "../src/lib/herdr-dashboard-watch.ts";

function sampleDiscovery(overrides: Partial<DashboardMetaDiscovery> = {}): DashboardMetaDiscovery {
  return {
    herdrSession: "",
    herdrSessionLabel: "primary",
    mode: "workspace",
    workspaceLabel: "kimi-toolchain",
    workspaceId: "wB",
    workspaceIdResolution: "single",
    workspaceCandidateCount: 1,
    remoteHostsConfigured: 1,
    remoteHosts: {
      configured: 1,
      reachable: 1,
      hosts: [{ label: "mac-mini", reachable: true, version: "1.0.0" }],
    },
    multiSessionEnabled: false,
    sessionsAvailable: [""],
    sessionCatalog: [{ session: "", label: "primary", host: "(local)", reachable: true }],
    ...overrides,
  };
}

describe("herdr-dashboard-watch", () => {
  test("computeDashboardMetaGateFingerprint uses resolution and count", () => {
    expect(
      computeDashboardMetaGateFingerprint({
        workspaceIdResolution: "pane_count",
        workspaceCandidateCount: 2,
      })
    ).toBe("pane_count|2");
  });

  test("first discovery refresh seeds fingerprint without gate re-run", () => {
    const state = {
      gateFingerprint: null as string | null,
      advisory: { sessionsAvailable: [] as string[], remoteHosts: [] },
    };
    const logs: string[] = [];
    const result = handleDashboardDiscoveryWatch(sampleDiscovery(), state, {
      log: (line) => logs.push(line),
    });
    expect(result.seeded).toBe(true);
    expect(result.gateChanged).toBe(false);
    expect(result.gateOk).toBe(true);
    expect(result.advisoryChanges).toEqual([]);
    expect(state.gateFingerprint).toBe("single|1");
    expect(logs).toEqual([]);
  });

  test("handleDashboardDiscoveryWatch re-gates on structural fingerprint change", () => {
    const state = {
      gateFingerprint: "single|1" as string | null,
      advisory: {
        sessionsAvailable: [""],
        remoteHosts: [{ label: "mac-mini", reachable: true, version: "1.0.0" }],
      },
    };
    const logs: string[] = [];
    const result = handleDashboardDiscoveryWatch(
      sampleDiscovery({ workspaceIdResolution: "pane_count", workspaceCandidateCount: 2 }),
      state,
      { log: (line) => logs.push(line) }
    );
    expect(result.gateChanged).toBe(true);
    expect(result.gateOk).toBe(true);
    expect(result.seeded).toBe(false);
    expect(state.gateFingerprint).toBe("pane_count|2");
    expect(logs.some((line) => line.includes("meta gate ok"))).toBe(true);
  });

  test("diffSessionsAvailable reports added and removed sessions", () => {
    expect(diffSessionsAvailable([""], ["", "dev"])).toEqual(["sessionsAvailable: added [dev]"]);
    expect(diffSessionsAvailable(["", "dev"], [""])).toEqual(["sessionsAvailable: removed [dev]"]);
  });

  test("diffRemoteHosts reports reachable and version flips by label", () => {
    const changes = diffRemoteHosts(
      [{ label: "mac-mini", reachable: true, version: "1.0.0" }],
      [{ label: "mac-mini", reachable: false, version: "1.0.0", error: "timeout" }]
    );
    expect(changes).toContain('remoteHosts.host "mac-mini": reachable true → false');
    expect(changes).toContain('remoteHosts.host "mac-mini": error — → timeout');
  });

  test("handleDashboardDiscoveryWatch logs advisory without re-gate when only host reachable changes", () => {
    const state = {
      gateFingerprint: "single|1" as string | null,
      advisory: {
        sessionsAvailable: [""],
        remoteHosts: [{ label: "mac-mini", reachable: true, version: "1.0.0" }],
      },
    };
    const logs: string[] = [];
    const result = handleDashboardDiscoveryWatch(
      sampleDiscovery({
        remoteHosts: {
          configured: 1,
          reachable: 0,
          hosts: [{ label: "mac-mini", reachable: false, version: "1.0.0" }],
        },
      }),
      state,
      { log: (line) => logs.push(line) }
    );
    expect(result.gateChanged).toBe(false);
    expect(result.advisoryChanges).toContain('remoteHosts.host "mac-mini": reachable true → false');
    expect(logs.some((line) => line.includes("advisory: remoteHosts.host"))).toBe(true);
    expect(state.gateFingerprint).toBe("single|1");
  });

  test("startDashboardMetaWatch subscribes to discovery:refreshed", () => {
    const bus = createDashboardEventBus();
    const watch = startDashboardMetaWatch(bus, { log: () => {} });
    bus.emit("discovery:refreshed", {
      payload: {
        ok: true,
        projectPath: ".",
        agentCount: 0,
        agents: [],
        fetchedAt: new Date().toISOString(),
      },
      fromCache: false,
      discovery: sampleDiscovery(),
      at: new Date().toISOString(),
    });
    expect(watch.state.gateFingerprint).toBe("single|1");
    watch.stop();
  });
});
