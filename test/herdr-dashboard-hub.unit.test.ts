import { describe, expect, test } from "bun:test";
import { HerdrDashboardHub, DASHBOARD_STALE_MS } from "../src/lib/herdr-dashboard-hub.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("herdr-dashboard-hub", () => {
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

  test("SSE polling pauses without subscribers and resumes on connect", async () => {
    const hub = new HerdrDashboardHub({ projectPath: REPO_ROOT, fetchOpts: {}, pollMs: 50 });
    hub.start();
    expect(
      (hub as unknown as { pollTimer: ReturnType<typeof setInterval> | null }).pollTimer
    ).toBeNull();

    const stream = hub.createAgentsLiveStream();
    expect(
      (hub as unknown as { pollTimer: ReturnType<typeof setInterval> | null }).pollTimer
    ).not.toBeNull();

    const reader = stream.getReader();
    await reader.cancel();
    await Bun.sleep(20);
    expect(
      (hub as unknown as { pollTimer: ReturnType<typeof setInterval> | null }).pollTimer
    ).toBeNull();

    hub.stop();
  });
});
