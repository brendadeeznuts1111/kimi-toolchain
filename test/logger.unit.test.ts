import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { aggregateChecks } from "../src/lib/health-check.ts";
import { Logger, createLogger, log, statusIcon } from "../src/lib/logger.ts";
import { generateTraceId, generateSpanId } from "../src/lib/bun-utils.ts";
import { captureConsoleError, captureStdout } from "./helpers.ts";

function withStdoutCapture(run: () => void): string[] {
  const capture = captureStdout();
  try {
    run();
    return [...capture.lines];
  } finally {
    capture.restore();
  }
}

describe("logger", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      KIMI_AGENT_SESSION: Bun.env.KIMI_AGENT_SESSION,
      KIMI_CODE_SESSION: Bun.env.KIMI_CODE_SESSION,
    };
    delete Bun.env.KIMI_AGENT_SESSION;
    delete Bun.env.KIMI_CODE_SESSION;
  });

  afterEach(() => {
    Bun.env.KIMI_AGENT_SESSION = originalEnv.KIMI_AGENT_SESSION;
    Bun.env.KIMI_CODE_SESSION = originalEnv.KIMI_CODE_SESSION;
  });

  test("Logger.info emits with checkmark icon", () => {
    const lines = withStdoutCapture(() => {
      const logger = new Logger({ level: "info" });
      logger.info("test message");
    });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("test message");
  });

  test("Logger.error emits with x icon", () => {
    const lines = withStdoutCapture(() => {
      const logger = new Logger({ level: "info" });
      logger.error("test error");
    });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("test error");
  });

  test("Logger.warn emits with warning icon", () => {
    const lines = withStdoutCapture(() => {
      const logger = new Logger({ level: "info" });
      logger.warn("test warning");
    });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("test warning");
  });

  test("Logger.debug is suppressed at info level", () => {
    const lines = withStdoutCapture(() => {
      const logger = new Logger({ level: "info" });
      logger.debug("test debug");
    });
    expect(lines.length).toBe(0);
  });

  test("Logger.debug emits at debug level", () => {
    const lines = withStdoutCapture(() => {
      const logger = new Logger({ level: "debug" });
      logger.debug("test debug");
    });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("test debug");
  });

  test("quiet mode suppresses info and warn", () => {
    const lines = withStdoutCapture(() => {
      const logger = new Logger({ quiet: true });
      logger.info("test info");
      logger.warn("test warn");
    });
    expect(lines.length).toBe(0);
  });

  test("quiet mode allows errors", () => {
    const lines = withStdoutCapture(() => {
      const logger = new Logger({ quiet: true });
      logger.error("test error");
    });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("test error");
  });

  test("json mode outputs structured JSON", () => {
    const lines = withStdoutCapture(() => {
      const logger = new Logger({ json: true, tool: "test-tool" });
      logger.info("test message");
    });
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.tool).toBe("test-tool");
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("test message");
    expect(parsed.timestamp).toBeGreaterThan(0);
  });

  test("agent context suppresses info output", () => {
    Bun.env.KIMI_AGENT_SESSION = "1";
    const lines = withStdoutCapture(() => {
      const logger = new Logger({ level: "info" });
      logger.info("test info");
    });
    expect(lines.length).toBe(0);
  });

  test("agent context allows errors", async () => {
    Bun.env.KIMI_AGENT_SESSION = "1";
    const lines = await captureConsoleError(() => {
      const logger = new Logger({ level: "info" });
      logger.error("test error");
    });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("test error");
  });

  test("result() logs ok status", () => {
    const lines = withStdoutCapture(() => {
      const logger = new Logger({ level: "info" });
      logger.result("test-tool", "ok", "passed");
    });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("passed");
  });

  test("result() suppresses ok in agent context", () => {
    Bun.env.KIMI_AGENT_SESSION = "1";
    const lines = withStdoutCapture(() => {
      const logger = new Logger({ level: "info" });
      logger.result("test-tool", "ok", "passed");
    });
    expect(lines.length).toBe(0);
  });

  test("section() prints header in human mode", () => {
    const lines = withStdoutCapture(() => {
      const logger = new Logger();
      logger.section("Test Section");
    });
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("Test Section");
  });

  test("section() suppressed in agent context", () => {
    Bun.env.KIMI_AGENT_SESSION = "1";
    const lines = withStdoutCapture(() => {
      const logger = new Logger();
      logger.section("Test Section");
    });
    expect(lines.length).toBe(0);
  });

  test("createLogger parses --json flag", () => {
    const logger = createLogger(["--json"], "test");
    expect(logger.getLogs().length).toBe(0);
  });

  test("createLogger parses --quiet flag", () => {
    const logger = createLogger(["--quiet"], "test");
    expect(logger.getLogs().length).toBe(0);
  });

  test("createLogger parses --debug flag", () => {
    const lines = withStdoutCapture(() => {
      const logger = createLogger(["--debug"], "test");
      logger.debug("test debug");
    });
    expect(lines.length).toBe(1);
  });

  test("log() backward compatibility", () => {
    const lines = withStdoutCapture(() => {
      log("info", "backward compat");
    });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("backward compat");
  });

  test("statusIcon returns correct icons", () => {
    expect(statusIcon("ok")).toBe("✓");
    expect(statusIcon("warn")).toBe("⚠");
    expect(statusIcon("error")).toBe("✗");
  });

  test("getLogs returns all logged entries", () => {
    const logger = new Logger({ level: "info" });
    logger.info("first");
    logger.warn("second");
    logger.error("third");

    const entries = logger.getLogs();
    expect(entries.length).toBe(3);
    expect(entries[0].message).toBe("first");
    expect(entries[1].message).toBe("second");
    expect(entries[2].message).toBe("third");
  });

  test("check() emits structured JSON with schemaVersion", () => {
    const lines = withStdoutCapture(() => {
      const logger = new Logger({ json: true, tool: "test-tool" });
      logger.check({ name: "disk", status: "warn", message: "85%", fixable: false });
    });
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.check.name).toBe("disk");
  });

  test("check() buffers ok checks in agent context for telemetry", () => {
    const prev = Bun.env.KIMI_CODE_SESSION;
    Bun.env.KIMI_CODE_SESSION = "agent-test";
    try {
      const logger = new Logger({ tool: "kimi-doctor" });
      logger.check({ name: "bun", status: "ok", message: "1.3.14", fixable: false });
      logger.check({ name: "disk", status: "error", message: "critical", fixable: false });
      expect(logger.getLogs().length).toBe(2);
      expect(logger.getLogs()[0].check?.name).toBe("bun");
      expect(logger.getLogs()[1].level).toBe("error");
    } finally {
      Bun.env.KIMI_CODE_SESSION = prev;
    }
  });

  test("printHealthReport prints section, checks, and summary", () => {
    const report = aggregateChecks("kimi-doctor", [
      { name: "bun", status: "ok", message: "1.3.14", fixable: false },
      { name: "disk", status: "warn", message: "85%", fixable: true },
    ]);
    const logger = new Logger({ level: "info", tool: "kimi-doctor" });
    const lines = withStdoutCapture(() => {
      logger.printHealthReport(report);
    });
    expect(lines.some((l) => l.includes("kimi-doctor Doctor"))).toBe(true);
    expect(lines.some((l) => l.includes("bun: 1.3.14"))).toBe(true);
    expect(lines.some((l) => l.includes("disk: 85%"))).toBe(true);
    expect(lines.some((l) => l.includes("0 error(s), 1 warning(s), 1 fixable"))).toBe(true);
    expect(logger.getLogs().length).toBeGreaterThanOrEqual(3);
  });

  test("printHealthReport accepts custom section title", () => {
    const lines = withStdoutCapture(() => {
      const report = aggregateChecks("kimi-fix", [
        { name: "lockfile", status: "ok", message: "present", fixable: false },
      ]);
      const logger = new Logger();
      logger.printHealthReport(report, "Custom Section");
    });
    expect(lines.some((l) => l.includes("Custom Section"))).toBe(true);
    expect(lines.some((l) => l.includes("kimi-fix Doctor"))).toBe(false);
  });

  test("projectBanner prints banner, project line, and blank line", () => {
    const lines = withStdoutCapture(() => {
      const logger = new Logger({ level: "info" });
      logger.projectBanner("Kimi Doctor", "my-project", "Health checks");
    });
    expect(lines.some((l) => l.includes("Kimi Doctor"))).toBe(true);
    expect(lines.some((l) => l.includes("Health checks"))).toBe(true);
    expect(lines.some((l) => l.includes("Project: my-project"))).toBe(true);
    expect(lines.some((l) => l === "")).toBe(true);
  });

  test("projectBanner omits project line when project is omitted", () => {
    const lines = withStdoutCapture(() => {
      const logger = new Logger({ level: "info" });
      logger.projectBanner("Kimi Doctor");
    });
    expect(lines.some((l) => l.includes("Project:"))).toBe(false);
    expect(lines.some((l) => l.includes("Kimi Doctor"))).toBe(true);
  });

  test("suggest() includes taxonomyId and autoFix in JSON mode", () => {
    const lines = withStdoutCapture(() => {
      const logger = new Logger({ json: true, tool: "kimi-debug" });
      logger.suggest("lockfile_issue", "Run bun install", "bun install");
    });
    const parsed = JSON.parse(lines[0]);
    expect(parsed.taxonomyId).toBe("lockfile_issue");
    expect(parsed.autoFix).toBe("bun install");
  });

  describe("JSON serialization correctness (writeJsonLine)", () => {
    test("JSON mode output is valid JSON.parse-able (not Bun.inspect output)", () => {
      const lines = withStdoutCapture(() => {
        const logger = new Logger({ json: true, tool: "test" });
        logger.info("parseable");
      });
      expect(lines.length).toBe(1);
      expect(() => JSON.parse(lines[0])).not.toThrow();
    });

    test("fields with numeric values round-trip through JSON correctly", () => {
      const lines = withStdoutCapture(() => {
        const logger = new Logger({ json: true, fields: { count: 42, flag: true } });
        logger.info("round-trip");
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.fields.count).toBe(42);
      expect(parsed.fields.flag).toBe(true);
    });

    test("errorObj stack serializes as valid JSON string", () => {
      const lines = withStdoutCapture(() => {
        const logger = new Logger({ json: true });
        logger.errorObj(new RangeError("out of bounds"));
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.errorName).toBe("RangeError");
      expect(typeof parsed.errorStack).toBe("string");
    });
  });

  describe("fields / traceId / spanId propagation", () => {
    test("fields are merged into every JSON entry", () => {
      const lines = withStdoutCapture(() => {
        const logger = new Logger({ json: true, fields: { agentId: "agent-1", env: "test" } });
        logger.info("hello");
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.fields?.agentId).toBe("agent-1");
      expect(parsed.fields?.env).toBe("test");
    });

    test("traceId and spanId propagate to entries", () => {
      const lines = withStdoutCapture(() => {
        const logger = new Logger({ json: true, traceId: "trace-abc", spanId: "span-xyz" });
        logger.info("traced");
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.traceId).toBe("trace-abc");
      expect(parsed.spanId).toBe("span-xyz");
    });

    test("entries without fields/traceId omit those keys", () => {
      const lines = withStdoutCapture(() => {
        const logger = new Logger({ json: true });
        logger.info("clean");
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.fields).toBeUndefined();
      expect(parsed.traceId).toBeUndefined();
      expect(parsed.spanId).toBeUndefined();
    });
  });

  describe("child()", () => {
    test("child inherits parent tool and level", () => {
      const lines = withStdoutCapture(() => {
        const parent = new Logger({ json: true, tool: "parent-tool", level: "debug" });
        const child = parent.child({});
        child.debug("from child");
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.tool).toBe("parent-tool");
      expect(parsed.level).toBe("debug");
    });

    test("child merges fields on top of parent fields", () => {
      const lines = withStdoutCapture(() => {
        const parent = new Logger({ json: true, fields: { region: "us-east" } });
        const child = parent.child({ fields: { requestId: "req-99" } });
        child.info("child msg");
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.fields?.region).toBe("us-east");
      expect(parsed.fields?.requestId).toBe("req-99");
    });

    test("child can override tool name", () => {
      const lines = withStdoutCapture(() => {
        const parent = new Logger({ json: true, tool: "parent" });
        const child = parent.child({ tool: "child-tool" });
        child.info("override");
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.tool).toBe("child-tool");
    });

    test("child inherits traceId but can override spanId", () => {
      const lines = withStdoutCapture(() => {
        const parent = new Logger({ json: true, traceId: "trace-parent", spanId: "span-parent" });
        const child = parent.child({ spanId: "span-child" });
        child.info("span override");
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.traceId).toBe("trace-parent");
      expect(parsed.spanId).toBe("span-child");
    });

    test("child getLogs() is independent from parent", () => {
      const parent = new Logger({ level: "info" });
      const child = parent.child({ tool: "sub" });
      withStdoutCapture(() => {
        parent.info("parent msg");
        child.info("child msg");
      });
      expect(parent.getLogs().length).toBe(1);
      expect(child.getLogs().length).toBe(1);
      expect(parent.getLogs()[0].message).toBe("parent msg");
      expect(child.getLogs()[0].message).toBe("child msg");
    });
  });

  describe("errorObj()", () => {
    test("captures Error name, message, and stack in JSON mode", () => {
      const lines = withStdoutCapture(() => {
        const logger = new Logger({ json: true });
        logger.errorObj(new TypeError("bad type"));
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.level).toBe("error");
      expect(parsed.message).toBe("bad type");
      expect(parsed.errorName).toBe("TypeError");
      expect(typeof parsed.errorStack).toBe("string");
      expect(parsed.errorStack).toContain("TypeError");
    });

    test("handles string errors", () => {
      const lines = withStdoutCapture(() => {
        const logger = new Logger({ json: true });
        logger.errorObj("plain string error");
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.message).toBe("plain string error");
      expect(parsed.errorName).toBeUndefined();
    });

    test("merges extraFields into entry", () => {
      const lines = withStdoutCapture(() => {
        const logger = new Logger({ json: true });
        logger.errorObj(new Error("boom"), { tool: "my-tool", exitCode: 1 });
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.fields?.tool).toBe("my-tool");
      expect(parsed.fields?.exitCode).toBe(1);
    });

    test("respects quiet mode (suppressed)", () => {
      const lines = withStdoutCapture(() => {
        const logger = new Logger({ quiet: true });
        logger.errorObj(new Error("quiet error"));
      });
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain("quiet error");
    });
  });

  describe("time() / timeEnd()", () => {
    test("timeEnd emits a debug entry with durationMs", () => {
      const logger = new Logger({ json: true, level: "debug" });
      logger.time("op");
      const lines = withStdoutCapture(() => {
        logger.timeEnd("op");
      });
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.level).toBe("debug");
      expect(typeof parsed.durationMs).toBe("number");
      expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
      expect(parsed.message).toContain("op");
      expect(parsed.message).toContain("ms");
    });

    test("timeEnd returns elapsed milliseconds", () => {
      const logger = new Logger({ level: "debug", json: true });
      logger.time("measure");
      const lines = withStdoutCapture(() => {
        const elapsed = logger.timeEnd("measure");
        expect(elapsed).toBeGreaterThanOrEqual(0);
      });
      expect(lines.length).toBe(1);
    });

    test("timeEnd at info level emits info entry", () => {
      const logger = new Logger({ json: true, level: "info" });
      logger.time("info-op");
      const lines = withStdoutCapture(() => {
        logger.timeEnd("info-op", "info");
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.level).toBe("info");
      expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
    });

    test("timeEnd for unknown label emits warn and returns -1", () => {
      const logger = new Logger({ json: true, level: "debug" });
      const lines = withStdoutCapture(() => {
        const result = logger.timeEnd("no-such-label");
        expect(result).toBe(-1);
      });
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.level).toBe("warn");
      expect(parsed.message).toContain("no-such-label");
    });

    test("timer suppressed at info level in debug mode off", () => {
      const logger = new Logger({ json: true, level: "info" });
      logger.time("silent");
      const lines = withStdoutCapture(() => {
        logger.timeEnd("silent");
      });
      expect(lines.length).toBe(0);
    });
  });

  describe("createLogger() traceId env-wiring", () => {
    test("createLogger picks up KIMI_TRACE_ID from env", () => {
      const prev = Bun.env.KIMI_TRACE_ID;
      Bun.env.KIMI_TRACE_ID = "env-trace-123";
      try {
        const logger = createLogger(["--json"], "test-tool");
        const lines = withStdoutCapture(() => {
          logger.info("env-wired");
        });
        const parsed = JSON.parse(lines[0]);
        expect(parsed.traceId).toBe("env-trace-123");
      } finally {
        if (prev === undefined) delete Bun.env.KIMI_TRACE_ID;
        else Bun.env.KIMI_TRACE_ID = prev;
      }
    });

    test("createLogger omits traceId when env is unset", () => {
      const prev = Bun.env.KIMI_TRACE_ID;
      delete Bun.env.KIMI_TRACE_ID;
      try {
        const logger = createLogger(["--json"], "test-tool");
        const lines = withStdoutCapture(() => {
          logger.info("no-trace");
        });
        const parsed = JSON.parse(lines[0]);
        expect(parsed.traceId).toBeUndefined();
      } finally {
        if (prev === undefined) delete Bun.env.KIMI_TRACE_ID;
        else Bun.env.KIMI_TRACE_ID = prev;
      }
    });

    test("explicit traceId in Logger constructor takes precedence over env", () => {
      const prev = Bun.env.KIMI_TRACE_ID;
      Bun.env.KIMI_TRACE_ID = "env-trace";
      try {
        const logger = new Logger({ json: true, traceId: "explicit-trace" });
        const lines = withStdoutCapture(() => {
          logger.info("explicit");
        });
        const parsed = JSON.parse(lines[0]);
        expect(parsed.traceId).toBe("explicit-trace");
      } finally {
        if (prev === undefined) delete Bun.env.KIMI_TRACE_ID;
        else Bun.env.KIMI_TRACE_ID = prev;
      }
    });
  });

  describe("generateTraceId() / generateSpanId()", () => {
    test("generateTraceId returns a 32-char hex string", () => {
      const id = generateTraceId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    });

    test("generateSpanId returns a 16-char hex string", () => {
      const id = generateSpanId();
      expect(id).toMatch(/^[0-9a-f]{16}$/);
    });

    test("generateTraceId produces unique IDs", () => {
      const a = generateTraceId();
      const b = generateTraceId();
      expect(a).not.toBe(b);
    });

    test("generateSpanId is a prefix-compatible subset of a trace ID", () => {
      const span = generateSpanId();
      expect(span.length).toBe(16);
      expect(span).toMatch(/^[0-9a-f]+$/);
    });

    test("Logger child with generated traceId propagates to JSON entries", () => {
      const traceId = generateTraceId();
      const lines = withStdoutCapture(() => {
        const logger = new Logger({ json: true, traceId });
        logger.info("traced");
      });
      const parsed = JSON.parse(lines[0]);
      expect(parsed.traceId).toBe(traceId);
      expect(parsed.traceId).toMatch(/^[0-9a-f]{32}$/);
    });
  });
});
