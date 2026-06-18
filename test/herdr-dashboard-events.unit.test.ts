import { describe, expect, test } from "bun:test";
import { createDashboardEventBus } from "../src/lib/herdr-dashboard-bus.ts";
import { routeDashboardHerdrEvent } from "../src/lib/herdr-dashboard-events.ts";
import { HerdrDashboardHub } from "../src/lib/herdr-dashboard-hub.ts";
import { HerdrDashboardDiscoveryCache } from "../src/lib/herdr-dashboard-discovery-cache.ts";
import type { DashboardAgentsPayload } from "../src/lib/herdr-dashboard-data.ts";
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
    await Bun.sleep(5);
    expect(calls).toBe(2);
    hub.stop();
  });
});
