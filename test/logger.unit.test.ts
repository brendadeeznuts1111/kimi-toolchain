import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { aggregateChecks } from "../src/lib/health-check.ts";
import { Logger, createLogger, log, statusIcon } from "../src/lib/logger.ts";
import { inspectAgent } from "../src/lib/inspect.ts";

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
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ level: "info" });
    logger.info("test message");

    console.log = originalLog;
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("test message");
  });

  test("Logger.error emits with x icon", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ level: "info" });
    logger.error("test error");

    console.log = originalLog;
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("test error");
  });

  test("Logger.warn emits with warning icon", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ level: "info" });
    logger.warn("test warning");

    console.log = originalLog;
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("test warning");
  });

  test("Logger.debug is suppressed at info level", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ level: "info" });
    logger.debug("test debug");

    console.log = originalLog;
    expect(logs.length).toBe(0);
  });

  test("Logger.debug emits at debug level", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ level: "debug" });
    logger.debug("test debug");

    console.log = originalLog;
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("test debug");
  });

  test("quiet mode suppresses info and warn", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ quiet: true });
    logger.info("test info");
    logger.warn("test warn");

    console.log = originalLog;
    expect(logs.length).toBe(0);
  });

  test("quiet mode allows errors", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ quiet: true });
    logger.error("test error");

    console.log = originalLog;
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("test error");
  });

  test("json mode outputs structured agent format", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ json: true, tool: "test-tool" });
    logger.info("test message");

    console.log = originalLog;
    expect(logs.length).toBe(1);
    const output = logs[0];
    expect(output).toContain("test-tool");
    expect(output).toContain("info");
    expect(output).toContain("test message");
    expect(output).toContain("timestamp");
  });

  test("agent context suppresses info output", () => {
    Bun.env.KIMI_AGENT_SESSION = "1";

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ level: "info" });
    logger.info("test info");

    console.log = originalLog;
    expect(logs.length).toBe(0);
  });

  test("agent context allows errors", () => {
    Bun.env.KIMI_AGENT_SESSION = "1";

    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ level: "info" });
    logger.error("test error");

    console.error = originalError;
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("test error");
  });

  test("result() logs ok status", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ level: "info" });
    logger.result("test-tool", "ok", "passed");

    console.log = originalLog;
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("passed");
  });

  test("result() suppresses ok in agent context", () => {
    Bun.env.KIMI_AGENT_SESSION = "1";

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ level: "info" });
    logger.result("test-tool", "ok", "passed");

    console.log = originalLog;
    expect(logs.length).toBe(0);
  });

  test("section() prints header in human mode", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger();
    logger.section("Test Section");

    console.log = originalLog;
    expect(logs.length).toBe(2); // empty line + header
    expect(logs[1]).toContain("Test Section");
  });

  test("section() suppressed in agent context", () => {
    Bun.env.KIMI_AGENT_SESSION = "1";

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger();
    logger.section("Test Section");

    console.log = originalLog;
    expect(logs.length).toBe(0);
  });

  test("createLogger parses --json flag", () => {
    const logger = createLogger(["--json"], "test");
    expect(logger.getLogs().length).toBe(0);
  });

  test("createLogger parses --quiet flag", () => {
    const logger = createLogger(["--quiet"], "test");
    expect(logger.getLogs()).toEqual([]);
  });

  test("createLogger enables quiet from KIMI_QUIET env", () => {
    Bun.env.KIMI_QUIET = "1";
    const logger = createLogger([], "test");
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    logger.info("hidden");
    console.log = originalLog;
    expect(logs.length).toBe(0);
    delete Bun.env.KIMI_QUIET;
  });

  test("createLogger parses --debug flag", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = createLogger(["--debug"], "test");
    logger.debug("test debug");

    console.log = originalLog;
    expect(logs.length).toBe(1);
  });

  test("log() backward compatibility", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    log("info", "backward compat");

    console.log = originalLog;
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("backward compat");
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

    const logs = logger.getLogs();
    expect(logs.length).toBe(3);
    expect(logs[0].message).toBe("first");
    expect(logs[1].message).toBe("second");
    expect(logs[2].message).toBe("third");
  });

  test("check() emits structured agent format with schemaVersion", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ json: true, tool: "test-tool" });
    logger.check({ name: "disk", status: "warn", message: "85%", fixable: false });

    console.log = originalLog;
    expect(logs.length).toBe(1);
    const output = logs[0];
    expect(output).toContain("schemaVersion");
    expect(output).toContain("disk");
    expect(output).toContain("85%");
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
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const report = aggregateChecks("kimi-doctor", [
      { name: "bun", status: "ok", message: "1.3.14", fixable: false },
      { name: "disk", status: "warn", message: "85%", fixable: true },
    ]);
    const logger = new Logger({ level: "info", tool: "kimi-doctor" });
    logger.printHealthReport(report);

    console.log = originalLog;
    expect(logs.some((l) => l.includes("kimi-doctor Doctor"))).toBe(true);
    expect(logs.some((l) => l.includes("bun: 1.3.14"))).toBe(true);
    expect(logs.some((l) => l.includes("disk: 85%"))).toBe(true);
    expect(logs.some((l) => l.includes("0 error(s), 1 warning(s), 1 fixable"))).toBe(true);
    expect(logger.getLogs().length).toBeGreaterThanOrEqual(3);
  });

  test("printHealthReport accepts custom section title", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const report = aggregateChecks("kimi-fix", [
      { name: "lockfile", status: "ok", message: "present", fixable: false },
    ]);
    const logger = new Logger();
    logger.printHealthReport(report, "Custom Section");

    console.log = originalLog;
    expect(logs.some((l) => l.includes("Custom Section"))).toBe(true);
    expect(logs.some((l) => l.includes("kimi-fix Doctor"))).toBe(false);
  });

  test("projectBanner prints banner, project line, and blank line", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ level: "info" });
    logger.projectBanner("Kimi Doctor", "my-project", "Health checks");

    console.log = originalLog;
    expect(logs.some((l) => l.includes("Kimi Doctor"))).toBe(true);
    expect(logs.some((l) => l.includes("Health checks"))).toBe(true);
    expect(logs.some((l) => l.includes("Project: my-project"))).toBe(true);
    expect(logs.some((l) => l === "")).toBe(true);
  });

  test("projectBanner omits project line when project is omitted", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ level: "info" });
    logger.projectBanner("Kimi Doctor");

    console.log = originalLog;
    expect(logs.some((l) => l.includes("Project:"))).toBe(false);
    expect(logs.some((l) => l.includes("Kimi Doctor"))).toBe(true);
  });

  test("suggest() includes taxonomyId and autoFix in JSON mode", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ json: true, tool: "kimi-debug" });
    logger.suggest("lockfile_issue", "Run bun install", "bun install");

    console.log = originalLog;
    expect(logs[0]).toBe(
      inspectAgent({
        schemaVersion: 1,
        tool: "kimi-debug",
        level: "info",
        message: "Run bun install",
        timestamp: logger.getLogs()[0]?.timestamp,
        taxonomyId: "lockfile_issue",
        suggestion: "Run bun install",
        autoFix: "bun install",
      })
    );
  });
});
