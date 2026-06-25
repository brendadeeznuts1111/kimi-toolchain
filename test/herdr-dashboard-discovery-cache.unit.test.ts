import { describe, expect, test } from "bun:test";
import { createDashboardEventBus } from "../src/lib/herdr-dashboard/bus.ts";
import { HerdrDashboardDiscoveryCache } from "../src/lib/herdr-dashboard/discovery/cache.ts";
import type { DashboardAgentsPayload } from "../src/lib/herdr-dashboard/data/data.ts";

const samplePayload = (agents: DashboardAgentsPayload["agents"]): DashboardAgentsPayload => ({
  ok: true,
  projectPath: "/tmp/project",
  agentCount: agents.length,
  agents,
  fetchedAt: new Date().toISOString(),
});

describe("herdr-dashboard-discovery-cache", () => {
  test("getAgents caches discovery results", async () => {
    let calls = 0;
    const cache = new HerdrDashboardDiscoveryCache({
      projectPath: "/tmp/project",
      fetchOpts: {},
      ttlMs: 60_000,
      discover: async () => {
        calls += 1;
        return samplePayload([
          {
            host: "(local)",
            session: "",
            workspaceId: "w1",
            agent: "kimi",
            status: "idle",
            paneId: "p1",
            source: "reported",
          },
        ]);
      },
    });

    const first = await cache.getAgents();
    const second = await cache.getAgents();
    expect(first.agentCount).toBe(1);
    expect(second.agentCount).toBe(1);
    expect(calls).toBe(1);
    expect(cache.stats().discovery.hits).toBe(1);
  });

  test("forceRefresh bypasses warm cache", async () => {
    let calls = 0;
    const cache = new HerdrDashboardDiscoveryCache({
      projectPath: "/tmp/project",
      fetchOpts: {},
      ttlMs: 60_000,
      discover: async () => {
        calls += 1;
        return samplePayload([]);
      },
    });

    await cache.getAgents();
    await cache.getAgents({ forceRefresh: true });
    expect(calls).toBe(2);
  });

  test("recordHeartbeats emits heartbeats:batch", () => {
    const bus = createDashboardEventBus();
    const seen: number[] = [];
    bus.on("heartbeats:batch", (payload) => {
      seen.push(payload.recorded);
    });
    const cache = new HerdrDashboardDiscoveryCache({
      projectPath: "/tmp/project",
      fetchOpts: {},
      ttlMs: 1000,
      bus,
    });
    const recorded = cache.recordHeartbeats([
      { agent: "kimi", host: "(local)", session: "work" },
      { agent: "codex" },
    ]);
    expect(recorded).toBe(2);
    expect(seen).toEqual([2]);
    expect(cache.stats().status.size).toBe(2);
  });

  test("fetchAndStore refreshes remote host probe status", async () => {
    let probeCalls = 0;
    const cache = new HerdrDashboardDiscoveryCache({
      projectPath: "/tmp/project",
      fetchOpts: {},
      ttlMs: 60_000,
      discover: async () => samplePayload([]),
      probeRemoteHosts: async () => {
        probeCalls += 1;
        return {
          configured: 2,
          reachable: 1,
          hosts: [
            { label: "staging", reachable: true, version: "0.9.4" },
            { label: "workbox", reachable: false, error: "timed out" },
          ],
        };
      },
    });

    await cache.getAgents();
    expect(probeCalls).toBe(1);
    const discovery = cache.discoveryContext();
    expect(discovery.remoteHosts.configured).toBe(2);
    expect(discovery.remoteHosts.reachable).toBe(1);
    expect(discovery.remoteHosts.hosts).toHaveLength(2);
  });

  test("background refresh notifies onDiscoveryRefreshed", async () => {
    let calls = 0;
    let releaseDiscover: (() => void) | undefined;
    const discoverGate = new Promise<void>((resolve) => {
      releaseDiscover = resolve;
    });
    const refreshed: number[] = [];
    const cache = new HerdrDashboardDiscoveryCache({
      projectPath: "/tmp/project",
      fetchOpts: {},
      ttlMs: 20,
      discover: async () => {
        calls += 1;
        if (calls >= 2) await discoverGate;
        return samplePayload([]);
      },
      probeRemoteHosts: async () => ({ configured: 0, reachable: 0, hosts: [] }),
      onDiscoveryRefreshed: (payload) => {
        refreshed.push(payload.agentCount);
      },
    });

    await cache.getAgents();
    expect(calls).toBe(1);
    await Bun.sleep(30);
    const stale = await cache.getAgents();
    expect(stale.agentCount).toBe(0);
    await Bun.sleep(5);
    expect(calls).toBe(2);
    expect(refreshed).toEqual([]);
    releaseDiscover?.();
    await Bun.sleep(10);
    expect(refreshed).toEqual([0]);
  });
});
