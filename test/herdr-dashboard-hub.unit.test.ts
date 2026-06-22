import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { createDashboardEventBus } from "../src/lib/herdr-dashboard-bus.ts";
import { HerdrDashboardDiscoveryCache } from "../src/lib/herdr-dashboard-discovery-cache.ts";
import { HerdrDashboardHub, DASHBOARD_STALE_MS } from "../src/lib/herdr-dashboard-hub.ts";
import { DashboardCronConfigError } from "../src/lib/herdr-dashboard/cron.ts";
import { Logger } from "../src/lib/logger.ts";
import type { DashboardAgentsPayload } from "../src/lib/herdr-dashboard-data.ts";
import { REPO_ROOT } from "./helpers.ts";

const HUB_TEST_MS = 20_000;

const quietLogger = new Logger({ quiet: true });

describe("herdr-dashboard-hub", () => {
  const bunRef = Bun as typeof Bun & { cron: typeof Bun.cron };
  const originalCron = Bun.cron;
  const cronJobs: Array<{
    schedule: string;
    callback: () => void | Promise<void>;
    stop: ReturnType<typeof mock>;
  }> = [];

  beforeEach(() => {
    cronJobs.length = 0;
    bunRef.cron = ((schedule: string, callback: () => void | Promise<void>) => {
      const job = { schedule, callback, stop: mock(() => {}) };
      cronJobs.push(job);
      return job;
    }) as unknown as typeof Bun.cron;
  });

  afterEach(() => {
    bunRef.cron = originalCron;
  });
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

  test(
    "createAgentsLiveStream emits SSE data lines",
    async () => {
      const hub = new HerdrDashboardHub({
        projectPath: REPO_ROOT,
        fetchOpts: {},
        logger: quietLogger,
      });
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
    },
    { timeout: HUB_TEST_MS }
  );

  test(
    "createAgentsLiveStream emits keepalive comments",
    async () => {
      const hub = new HerdrDashboardHub({
        projectPath: REPO_ROOT,
        fetchOpts: {},
        logger: quietLogger,
      });
      const stream = hub.createAgentsLiveStream();
      const reader = stream.getReader();
      await reader.read();
      const chunk = await reader.read();
      await reader.cancel();
      hub.stop();
      expect(new TextDecoder().decode(chunk.value).startsWith(": keepalive")).toBe(true);
    },
    { timeout: HUB_TEST_MS }
  );

  test(
    "refresh emits agent:updated when status changes",
    async () => {
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
    },
    { timeout: HUB_TEST_MS }
  );

  test(
    "start() keeps background polling after SSE disconnect",
    async () => {
      const discoveryCache = new HerdrDashboardDiscoveryCache({
        projectPath: REPO_ROOT,
        fetchOpts: {},
        ttlMs: 5000,
        discover: async () =>
          ({
            ok: true,
            projectPath: REPO_ROOT,
            agentCount: 0,
            agents: [],
            fetchedAt: new Date().toISOString(),
          }) satisfies DashboardAgentsPayload,
      });
      const hub = new HerdrDashboardHub({
        projectPath: REPO_ROOT,
        fetchOpts: {},
        pollMs: 1000,
        logger: quietLogger,
        discoveryCache,
      });
      hub.start();
      expect((hub as unknown as { cronJob: Disposable | null }).cronJob).not.toBeNull();

      const stream = hub.createAgentsLiveStream();
      const reader = stream.getReader();
      await reader.cancel();
      await Bun.sleep(20);
      expect((hub as unknown as { cronJob: Disposable | null }).cronJob).not.toBeNull();

      hub.stop();
      expect((hub as unknown as { cronJob: Disposable | null }).cronJob).toBeNull();
    },
    { timeout: HUB_TEST_MS }
  );

  test("start() rejects sub-second poll intervals", () => {
    const hub = new HerdrDashboardHub({ projectPath: REPO_ROOT, fetchOpts: {}, pollMs: 500 });
    expect(() => hub.start()).toThrow(DashboardCronConfigError);
  });

  test("refreshDiscovery skips overlapping invocations", async () => {
    let resolveFirst: (value: DashboardAgentsPayload) => void = () => {};
    const firstPromise = new Promise<DashboardAgentsPayload>((resolve) => {
      resolveFirst = resolve;
    });

    const discoveryCache = new HerdrDashboardDiscoveryCache({
      projectPath: REPO_ROOT,
      fetchOpts: {},
      ttlMs: 5000,
      discover: async () => {
        await firstPromise;
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
      discoveryCache,
    });

    const p1 = hub.refreshDiscovery();
    const p2 = hub.refreshDiscovery();

    await p2;
    expect((hub as unknown as { discovering: boolean }).discovering).toBe(true);

    resolveFirst({
      ok: true,
      projectPath: REPO_ROOT,
      agentCount: 0,
      agents: [],
      fetchedAt: new Date().toISOString(),
    });
    await p1;
  });

  test("ssePollMs exposes the configured interval", () => {
    const hub = new HerdrDashboardHub({ projectPath: REPO_ROOT, fetchOpts: {}, pollMs: 7000 });
    expect(hub.ssePollMs).toBe(7000);
  });
});
