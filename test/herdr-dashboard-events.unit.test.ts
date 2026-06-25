import { describe, expect, test } from "bun:test";
import { createDashboardEventBus } from "../src/lib/herdr-dashboard/bus.ts";
import {
  routeDashboardHerdrEvent,
  startDashboardHerdrEventBridge,
} from "../src/lib/herdr-dashboard/server/events.ts";
import { HerdrDashboardHub } from "../src/lib/herdr-dashboard/server/hub.ts";
import { HerdrDashboardDiscoveryCache } from "../src/lib/herdr-dashboard/discovery/cache.ts";
import type { DashboardAgentsPayload } from "../src/lib/herdr-dashboard/data/data.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("herdr-dashboard-events", () => {
  test("routeDashboardHerdrEvent maps pane.agent_status_changed to refresh-agents", () => {
    const routed = routeDashboardHerdrEvent(
      { event: "pane.agent_status_changed", data: { pane_id: "p1" } },
      ["pane.agent_status_changed"]
    );
    expect(routed?.action).toBe("refresh-agents");
    expect(routed?.reason).toBe("pane.agent_status_changed");
  });

  test("routeDashboardHerdrEvent maps workspace.updated to refresh-agents", () => {
    const routed = routeDashboardHerdrEvent({ event: "workspace.updated", data: {} }, [
      "workspace.updated",
    ]);
    expect(routed?.action).toBe("refresh-agents");
    expect(routed?.reason).toBe("workspace.updated");
  });

  test("routeDashboardHerdrEvent respects allowlist", () => {
    const routed = routeDashboardHerdrEvent({ event: "pane.agent_status_changed", data: {} }, [
      "workspace.updated",
    ]);
    expect(routed).toBeNull();
  });

  test("hub reacts to herdr:event by forcing discovery refresh", async () => {
    let calls = 0;
    const bus = createDashboardEventBus();
    const discoveryCache = new HerdrDashboardDiscoveryCache({
      projectPath: REPO_ROOT,
      fetchOpts: {},
      ttlMs: 60_000,
      bus,
      discover: async () => {
        calls += 1;
        return {
          ok: true,
          projectPath: REPO_ROOT,
          agentCount: 0,
          agents: [],
          fetchedAt: new Date().toISOString(),
        } satisfies DashboardAgentsPayload;
      },
      probeRemoteHosts: async () => ({ configured: 0, reachable: 0, hosts: [] }),
      enumerateSessions: async () => ({
        sessionsAvailable: [""],
        entries: [{ session: "", label: "primary", host: "(local)", reachable: true }],
        errors: [],
      }),
    });

    const hub = new HerdrDashboardHub({
      projectPath: REPO_ROOT,
      fetchOpts: {},
      bus,
      discoveryCache,
    });

    await hub.refresh();
    expect(calls).toBe(1);

    bus.emit("herdr:event", {
      event: "pane.agent_status_changed",
      reason: "pane.agent_status_changed",
      at: new Date().toISOString(),
    });
    await Bun.sleep(20);
    expect(calls).toBe(2);
    hub.stop();
  });

  test("stop before async socket connect does not leave bridge pending", async () => {
    const hub = new HerdrDashboardHub({
      projectPath: REPO_ROOT,
      fetchOpts: { sessions: false },
      discoveryCache: new HerdrDashboardDiscoveryCache({
        projectPath: REPO_ROOT,
        fetchOpts: { sessions: false },
        ttlMs: 60_000,
      }),
    });

    const bridge = startDashboardHerdrEventBridge({
      projectPath: REPO_ROOT,
      hub,
    });
    bridge.stop();
    await Bun.sleep(0);
    expect(bridge.status().pending).toBe(false);
    hub.stop();
  });

  test("connect false defers bridge without opening socket", () => {
    const hub = new HerdrDashboardHub({
      projectPath: REPO_ROOT,
      fetchOpts: { sessions: false },
      discoveryCache: new HerdrDashboardDiscoveryCache({
        projectPath: REPO_ROOT,
        fetchOpts: { sessions: false },
        ttlMs: 60_000,
      }),
    });

    const bridge = startDashboardHerdrEventBridge({
      projectPath: REPO_ROOT,
      hub,
      connect: false,
    });
    expect(bridge.status().pending).toBe(false);
    expect(bridge.status().error).toBe("event bridge deferred");
    bridge.stop();
    hub.stop();
  });
});
