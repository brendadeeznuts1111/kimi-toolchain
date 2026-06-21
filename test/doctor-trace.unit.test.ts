import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createLogger } from "../src/lib/logger.ts";
import { ensureProcessTrace, TRACE_ID_ENV } from "../src/lib/effect/trace-context.ts";
import { buildTraceEvent, recordTraceEvent, readTraceEvents } from "../src/lib/trace-ledger.ts";
import { traceEventsPath } from "../src/lib/paths.ts";

describe("doctor tracing", () => {
  let tempHome: string;
  let oldHome: string | undefined;

  beforeEach(() => {
    tempHome = join(tmpdir(), `kimi-doctor-trace-${Bun.randomUUIDv7()}`);
    mkdirSync(join(tempHome, ".kimi-code", "var"), { recursive: true });
    oldHome = Bun.env.HOME;
    Bun.env.HOME = tempHome;
  });

  afterEach(() => {
    if (oldHome === undefined) delete Bun.env.HOME;
    else Bun.env.HOME = oldHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  test("ensureProcessTrace and createLogger share the same traceId", () => {
    const prev = Bun.env[TRACE_ID_ENV];
    delete Bun.env[TRACE_ID_ENV];
    try {
      const trace = ensureProcessTrace();
      const logger = createLogger(["--json"], "kimi-doctor");
      const entries = logger.getLogs();
      // createLogger reads KIMI_TRACE_ID which ensureProcessTrace sets in env
      expect(Bun.env[TRACE_ID_ENV]).toBe(trace.traceId);
      // Logger should have the same traceId wired from env
      logger.info("test");
      const logs = logger.getLogs();
      expect(logs[logs.length - 1].traceId).toBe(trace.traceId);
    } finally {
      if (prev === undefined) delete Bun.env[TRACE_ID_ENV];
      else Bun.env[TRACE_ID_ENV] = prev;
    }
  });

  test("section trace events are recorded in the trace ledger", async () => {
    const trace = ensureProcessTrace();
    const tracePath = traceEventsPath();

    // Simulate what kimi-doctor's traceSection() does
    const startedAt = new Date().toISOString();
    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const durationMs = Date.now() - started;

    await recordTraceEvent(
      buildTraceEvent({
        traceId: trace.traceId,
        parentTraceId: trace.parentTraceId,
        eventType: "cli",
        tool: "kimi-doctor",
        command: ["section", "system"],
        cwd: Bun.cwd,
        status: "ok",
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs,
        metadata: { section: "system" },
      })
    );

    const events = await readTraceEvents(tracePath);
    const sectionEvent = events.find(
      (e) => e.tool === "kimi-doctor" && e.metadata?.section === "system"
    );
    expect(sectionEvent).toBeDefined();
    expect(sectionEvent!.traceId).toBe(trace.traceId);
    expect(sectionEvent!.eventType).toBe("cli");
    expect(sectionEvent!.status).toBe("ok");
    expect(typeof sectionEvent!.durationMs).toBe("number");
    expect(sectionEvent!.durationMs).toBeGreaterThanOrEqual(0);
    expect(sectionEvent!.metadata?.section).toBe("system");
  });

  test("multiple section trace events are all recorded", async () => {
    const trace = ensureProcessTrace();
    const tracePath = traceEventsPath();

    for (const section of ["system", "products", "mcp", "quality"]) {
      await recordTraceEvent(
        buildTraceEvent({
          traceId: trace.traceId,
          parentTraceId: trace.parentTraceId,
          eventType: "cli",
          tool: "kimi-doctor",
          command: ["section", section],
          cwd: Bun.cwd,
          status: "ok",
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          durationMs: Math.random() * 100,
          metadata: { section },
        })
      );
    }

    const events = await readTraceEvents(tracePath);
    const sectionEvents = events.filter(
      (e) => e.tool === "kimi-doctor" && typeof e.metadata?.section === "string"
    );
    expect(sectionEvents.length).toBe(4);
    const sections = sectionEvents.map((e) => e.metadata?.section);
    expect(sections).toContain("system");
    expect(sections).toContain("products");
    expect(sections).toContain("mcp");
    expect(sections).toContain("quality");
  });

  test("trace events can be reconstructed into a graph with section metadata", async () => {
    const trace = ensureProcessTrace();
    const tracePath = traceEventsPath();

    // Record a top-level CLI event + a section event with the same traceId
    await recordTraceEvent(
      buildTraceEvent({
        traceId: trace.traceId,
        eventType: "cli",
        tool: "kimi-doctor",
        command: ["kimi-doctor", "--json"],
        cwd: Bun.cwd,
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
        cwd: Bun.cwd,
        status: "ok",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 50,
        metadata: { section: "system" },
      })
    );

    const events = await readTraceEvents(tracePath);
    const doctorEvents = events.filter((e) => e.traceId === trace.traceId);
    expect(doctorEvents.length).toBe(2);
    // Both events share the same traceId, enabling graph reconstruction
    expect(doctorEvents.every((e) => e.traceId === trace.traceId)).toBe(true);
  });
});
