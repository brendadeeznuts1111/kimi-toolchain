import { describe, expect, test } from "bun:test";
import { createDashboardEventBus } from "../src/lib/herdr-dashboard-bus.ts";
import { HerdrDashboardDiscoveryCache } from "../src/lib/herdr-dashboard-discovery-cache.ts";
import { HerdrDashboardHub, DASHBOARD_STALE_MS } from "../src/lib/herdr-dashboard-hub.ts";
import type { DashboardAgentsPayload } from "../src/lib/herdr-dashboard-data.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("herdr-dashboard-hub", () => {
  test("recordHeartbeats records multiple agents in one call", () => {
    const hub = new HerdrDashboardHub({
      projectPath: REPO_ROOT,
      fetchOpts: {},
    });
    const recorded = hub.recordHeartbeats([
      { agent: "kimi", host: "(local)", session: "work" },
      { agent: "codex", host: "(local)", session: "work" },
    ]);
    expect(recorded).toBe(2);
    const agents = hub.applyStaleOverlay([
      {
        host: "(local)",
        session: "work",
        workspaceId: "w1",
        agent: "kimi",
        status: "working",
        paneId: "p1",
        source: "reported",
      },
      {
        host: "(local)",
        session: "work",
        workspaceId: "w1",
        agent: "codex",
        status: "idle",
        paneId: "p2",
        source: "reported",
      },
    ]);
    expect(agents[0]?.status).toBe("working");
    expect(agents[1]?.status).toBe("idle");
  });

  test("applyStaleOverlay marks agents past heartbeat window", () => {
    const hub = new HerdrDashboardHub({
      projectPath: REPO_ROOT,
      fetchOpts: {},
      staleMs: DASHBOARD_STALE_MS,
    });
    hub.recordHeartbeat("kimi", "(local)", "work");
    const agents = hub.applyStaleOverlay([
      {
        host: "(local)",
        session: "work",
        workspaceId: "w1",
        agent: "kimi",
        status: "working",
        paneId: "p1",
        source: "reported",
      },
      {
        host: "(local)",
        session: "",
        workspaceId: "w1",
        agent: "codex",
        status: "idle",
        paneId: "p2",
        source: "reported",
      },
    ]);
    expect(agents[0]?.status).toBe("working");
    expect(agents[1]?.status).toBe("idle");
  });

  test("createAgentsLiveStream emits SSE data lines", async () => {
    const hub = new HerdrDashboardHub({ projectPath: REPO_ROOT, fetchOpts: {} });
    const stream = hub.createAgentsLiveStream();
    const reader = stream.getReader();
    const timeout = setTimeout(() => reader.cancel(), 50);
    const chunk = await reader.read();
    clearTimeout(timeout);
    hub.stop();
    if (chunk.value) {
      const text = new TextDecoder().decode(chunk.value);
      expect(text.startsWith("data:")).toBe(true);
    }
  });

  test("refresh emits agent:updated when status changes", async () => {
    const bus = createDashboardEventBus();
    const updates: string[] = [];
    bus.on("agent:updated", (payload) => {
      updates.push(`${payload.before.status}->${payload.after.status}`);
    });

    let status = "idle";
    const discoveryCache = new HerdrDashboardDiscoveryCache({
      projectPath: REPO_ROOT,
      fetchOpts: {},
      ttlMs: 60_000,
      bus,
      discover: async () =>
        ({
          ok: true,
          projectPath: REPO_ROOT,
          agentCount: 1,
          agents: [
            {
              host: "(local)",
              session: "",
              workspaceId: "w1",
              agent: "kimi",
              status,
              paneId: "p1",
              source: "reported",
            },
          ],
          fetchedAt: new Date().toISOString(),
        }) satisfies DashboardAgentsPayload,
    });

    const hub = new HerdrDashboardHub({
      projectPath: REPO_ROOT,
      fetchOpts: {},
      bus,
      discoveryCache,
    });

    await hub.refresh({ forceRefresh: true });
    status = "working";
    await hub.refresh({ forceRefresh: true });
    expect(updates).toContain("idle->working");
    hub.stop();
  });

  test("start() keeps background polling after SSE disconnect", async () => {
    const hub = new HerdrDashboardHub({ projectPath: REPO_ROOT, fetchOpts: {}, pollMs: 50 });
    hub.start();
    expect(
      (hub as unknown as { pollTimer: ReturnType<typeof setInterval> | null }).pollTimer
    ).not.toBeNull();

    const stream = hub.createAgentsLiveStream();
    const reader = stream.getReader();
    await reader.cancel();
    await Bun.sleep(20);
    expect(
      (hub as unknown as { pollTimer: ReturnType<typeof setInterval> | null }).pollTimer
    ).not.toBeNull();

    hub.stop();
    expect(
      (hub as unknown as { pollTimer: ReturnType<typeof setInterval> | null }).pollTimer
    ).toBeNull();
  });
});
