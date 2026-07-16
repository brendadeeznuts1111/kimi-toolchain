import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { apiTraceLedger, apiTraceGraph } from "../examples/dashboard/src/handlers/trace-ledger.ts";
import { buildTraceEvent, recordTraceEvent } from "../src/lib/trace-ledger.ts";
import { ensureProcessTrace } from "../src/lib/effect/trace-context.ts";
import { makeDir, removePath } from "./helpers.ts";

// Serial: tests mutate Bun.env.HOME and share trace-events.jsonl via paths.ts
describe.serial("dashboard-trace-ledger", () => {
  let tempHome: string;
  let oldHome: string | undefined;

  beforeEach(() => {
    tempHome = join(tmpdir(), `dash-trace-${Bun.randomUUIDv7()}`);
    makeDir(join(tempHome, ".kimi-code", "var"), { recursive: true });
    oldHome = Bun.env.HOME;
    Bun.env.HOME = tempHome;
  });

  afterEach(() => {
    if (oldHome === undefined) delete Bun.env.HOME;
    else Bun.env.HOME = oldHome;
    removePath(tempHome, { recursive: true, force: true });
  });

  test("apiTraceLedger returns empty stats when no events exist", async () => {
    const res = await apiTraceLedger(new Request("http://localhost/api/trace-ledger"));
    const data = (await res.json()) as {
      stats: {
        totalEvents: number;
        uniqueTraces: number;
        errorCount: number;
        avgDurationMs: number;
      };
      recentEvents: unknown[];
      recentFailures: unknown[];
    };
    expect(data.stats.totalEvents).toBe(0);
    expect(data.stats.uniqueTraces).toBe(0);
    expect(data.stats.errorCount).toBe(0);
    expect(data.stats.avgDurationMs).toBe(0);
    expect(data.recentEvents).toEqual([]);
    expect(data.recentFailures).toEqual([]);
  });

  test("apiTraceLedger returns recent events with correct shape", async () => {
    const trace = ensureProcessTrace();
    await recordTraceEvent(
      buildTraceEvent({
        traceId: trace.traceId,
        eventType: "cli",
        tool: "kimi-doctor",
        command: ["kimi-doctor", "--quick"],
        cwd: "/tmp",
        status: "ok",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 100,
        metadata: { section: "system" },
      })
    );

    const res = await apiTraceLedger(new Request("http://localhost/api/trace-ledger"));
    const data = (await res.json()) as {
      stats: {
        totalEvents: number;
        uniqueTraces: number;
        errorCount: number;
        avgDurationMs: number;
        byTool: Record<string, number>;
      };
      recentEvents: {
        traceId: string;
        tool: string;
        section?: string;
        status: string;
        durationMs?: number;
      }[];
    };
    expect(data.stats.totalEvents).toBe(1);
    expect(data.stats.uniqueTraces).toBe(1);
    expect(data.stats.errorCount).toBe(0);
    expect(data.stats.avgDurationMs).toBe(100);
    expect(data.stats.byTool["kimi-doctor"]).toBe(1);
    expect(data.recentEvents.length).toBe(1);
    expect(data.recentEvents[0]?.traceId).toBe(trace.traceId);
    expect(data.recentEvents[0]?.tool).toBe("kimi-doctor");
    expect(data.recentEvents[0]?.section).toBe("system");
    expect(data.recentEvents[0]?.status).toBe("ok");
    expect(data.recentEvents[0]?.durationMs).toBe(100);
  });

  test("apiTraceLedger counts errors correctly", async () => {
    const trace = ensureProcessTrace();
    await recordTraceEvent(
      buildTraceEvent({
        traceId: trace.traceId,
        eventType: "cli",
        tool: "kimi-doctor",
        status: "ok",
        startedAt: new Date().toISOString(),
        durationMs: 50,
      })
    );
    await recordTraceEvent(
      buildTraceEvent({
        traceId: trace.traceId,
        eventType: "cli",
        tool: "kimi-guardian",
        status: "error",
        startedAt: new Date().toISOString(),
        durationMs: 30,
        error: "lockfile mismatch",
      })
    );

    const res = await apiTraceLedger(new Request("http://localhost/api/trace-ledger"));
    const data = (await res.json()) as {
      stats: { totalEvents: number; errorCount: number; byTool: Record<string, number> };
    };
    expect(data.stats.totalEvents).toBe(2);
    expect(data.stats.errorCount).toBe(1);
    expect(data.stats.byTool["kimi-doctor"]).toBe(1);
    expect(data.stats.byTool["kimi-guardian"]).toBe(1);
  });

  test("apiTraceLedger limits to 50 recent events (newest first)", async () => {
    const trace = ensureProcessTrace();
    for (let i = 0; i < 55; i++) {
      await recordTraceEvent(
        buildTraceEvent({
          traceId: trace.traceId,
          eventType: "cli",
          tool: "test-tool",
          status: "ok",
          startedAt: new Date(Date.now() + i).toISOString(),
          durationMs: i,
        })
      );
    }

    const res = await apiTraceLedger(new Request("http://localhost/api/trace-ledger"));
    const data = (await res.json()) as {
      stats: { totalEvents: number };
      recentEvents: { durationMs?: number }[];
    };
    expect(data.stats.totalEvents).toBe(55);
    expect(data.recentEvents.length).toBe(50);
    // Newest first — highest durationMs should be first
    expect(data.recentEvents[0]?.durationMs).toBe(54);
    expect(data.recentEvents[49]?.durationMs).toBe(5);
  });

  test("apiTraceGraph returns found:false for unknown traceId", async () => {
    const res = await apiTraceGraph(
      new Request("http://localhost/api/trace-ledger/graph?traceId=nonexistent")
    );
    const data = (await res.json()) as { found: boolean; traceId: string };
    expect(data.found).toBe(false);
    expect(data.traceId).toBe("nonexistent");
  });

  test("apiTraceGraph returns tree and nodes for known traceId", async () => {
    const trace = ensureProcessTrace();
    await recordTraceEvent(
      buildTraceEvent({
        traceId: trace.traceId,
        eventType: "cli",
        tool: "kimi-doctor",
        command: ["kimi-doctor"],
        cwd: "/tmp",
        status: "ok",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 500,
      })
    );
    await recordTraceEvent(
      buildTraceEvent({
        traceId: trace.traceId,
        eventType: "cli",
        tool: "kimi-doctor",
        command: ["section", "system"],
        cwd: "/tmp",
        status: "ok",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 100,
        metadata: { section: "system" },
      })
    );

    const res = await apiTraceGraph(
      new Request(`http://localhost/api/trace-ledger/graph?traceId=${trace.traceId}`)
    );
    const data = (await res.json()) as {
      found: boolean;
      rootTraceId: string;
      tree: string;
      nodes: { events: unknown[] }[];
    };
    expect(data.found).toBe(true);
    expect(data.rootTraceId).toBe(trace.traceId);
    expect(typeof data.tree).toBe("string");
    expect(data.tree).toContain("kimi-doctor");
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(data.nodes[0]?.events.length).toBeGreaterThanOrEqual(1);
  });

  test("apiTraceGraph returns 400 when traceId is missing", async () => {
    const res = await apiTraceGraph(new Request("http://localhost/api/trace-ledger/graph"));
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("traceId");
  });

  test("apiTraceLedger filters by tool", async () => {
    const trace = ensureProcessTrace();
    for (const tool of ["kimi-doctor", "kimi-guardian", "kimi-doctor"]) {
      await recordTraceEvent(
        buildTraceEvent({
          traceId: trace.traceId,
          eventType: "cli",
          tool,
          status: "ok",
          startedAt: new Date().toISOString(),
          durationMs: 10,
        })
      );
    }

    const res = await apiTraceLedger(
      new Request("http://localhost/api/trace-ledger?tool=kimi-doctor")
    );
    const data = (await res.json()) as {
      stats: { totalEvents: number };
      recentEvents: { tool: string }[];
    };
    expect(data.stats.totalEvents).toBe(2);
    expect(data.recentEvents.every((e) => e.tool === "kimi-doctor")).toBe(true);
  });

  test("apiTraceLedger filters by status", async () => {
    const trace = ensureProcessTrace();
    await recordTraceEvent(
      buildTraceEvent({
        traceId: trace.traceId,
        eventType: "cli",
        tool: "kimi-doctor",
        status: "ok",
        startedAt: new Date().toISOString(),
        durationMs: 10,
      })
    );
    await recordTraceEvent(
      buildTraceEvent({
        traceId: trace.traceId,
        eventType: "cli",
        tool: "kimi-guardian",
        status: "error",
        startedAt: new Date().toISOString(),
        durationMs: 20,
        error: "fail",
      })
    );

    const res = await apiTraceLedger(new Request("http://localhost/api/trace-ledger?status=error"));
    const data = (await res.json()) as {
      stats: { totalEvents: number; errorCount: number };
      recentEvents: { status: string }[];
    };
    expect(data.stats.totalEvents).toBe(1);
    expect(data.stats.errorCount).toBe(1);
    expect(data.recentEvents.every((e) => e.status === "error")).toBe(true);
  });

  test("apiTraceLedger respects limit param", async () => {
    const trace = ensureProcessTrace();
    for (let i = 0; i < 20; i++) {
      await recordTraceEvent(
        buildTraceEvent({
          traceId: trace.traceId,
          eventType: "cli",
          tool: "test-tool",
          status: "ok",
          startedAt: new Date(Date.now() + i).toISOString(),
          durationMs: i,
        })
      );
    }

    const res = await apiTraceLedger(new Request("http://localhost/api/trace-ledger?limit=5"));
    const data = (await res.json()) as {
      stats: { totalEvents: number };
      recentEvents: unknown[];
    };
    expect(data.stats.totalEvents).toBe(20);
    expect(data.recentEvents.length).toBe(5);
  });

  test("apiTraceLedger computes p95, max, and errorRate", async () => {
    const trace = ensureProcessTrace();
    const durations = [10, 20, 30, 40, 100, 200];
    for (let i = 0; i < durations.length; i++) {
      await recordTraceEvent(
        buildTraceEvent({
          traceId: trace.traceId,
          eventType: "cli",
          tool: "test-tool",
          status: i === 0 ? "error" : "ok",
          startedAt: new Date().toISOString(),
          durationMs: durations[i],
        })
      );
    }

    const res = await apiTraceLedger(new Request("http://localhost/api/trace-ledger"));
    const data = (await res.json()) as {
      stats: {
        p95DurationMs: number;
        maxDurationMs: number;
        errorRate: number;
        byStatus: Record<string, number>;
      };
    };
    expect(data.stats.maxDurationMs).toBe(200);
    expect(data.stats.p95DurationMs).toBeGreaterThanOrEqual(100);
    expect(data.stats.errorRate).toBeCloseTo(16.7, 0);
    expect(data.stats.byStatus["ok"]).toBe(5);
    expect(data.stats.byStatus["error"]).toBe(1);
  });

  test("apiTraceLedger returns trace summaries grouped by traceId", async () => {
    const trace1 = Bun.randomUUIDv7();
    const trace2 = Bun.randomUUIDv7();

    await recordTraceEvent(
      buildTraceEvent({
        traceId: trace1,
        eventType: "cli",
        tool: "kimi-doctor",
        status: "ok",
        startedAt: new Date(Date.now() - 1000).toISOString(),
        durationMs: 100,
        metadata: { section: "system" },
      })
    );
    await recordTraceEvent(
      buildTraceEvent({
        traceId: trace1,
        eventType: "cli",
        tool: "kimi-doctor",
        status: "ok",
        startedAt: new Date(Date.now() - 500).toISOString(),
        durationMs: 50,
        metadata: { section: "config" },
      })
    );
    await recordTraceEvent(
      buildTraceEvent({
        traceId: trace2,
        eventType: "cli",
        tool: "kimi-guardian",
        status: "error",
        startedAt: new Date().toISOString(),
        durationMs: 200,
      })
    );

    const res = await apiTraceLedger(new Request("http://localhost/api/trace-ledger"));
    const data = (await res.json()) as {
      traceSummaries: {
        traceId: string;
        eventCount: number;
        tool: string;
        status: string;
        totalDurationMs: number;
        sections: string[];
        hasErrors: boolean;
      }[];
    };
    expect(data.traceSummaries.length).toBe(2);
    // trace2 is newer, should be first
    expect(data.traceSummaries[0]?.traceId).toBe(trace2);
    expect(data.traceSummaries[0]?.eventCount).toBe(1);
    expect(data.traceSummaries[0]?.hasErrors).toBe(true);
    expect(data.traceSummaries[0]?.status).toBe("error");
    // trace1 has 2 events, 2 sections, no errors
    const t1 = data.traceSummaries.find((t) => t.traceId === trace1);
    expect(t1).toBeDefined();
    expect(t1!.eventCount).toBe(2);
    expect(t1!.totalDurationMs).toBe(150);
    expect(t1!.sections).toEqual(["system", "config"]);
    expect(t1!.hasErrors).toBe(false);
    expect(t1!.status).toBe("ok");
  });
});
