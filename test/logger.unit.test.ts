import { describe, expect, test, beforeEach } from "bun:test";
import { aggregateChecks } from "../src/lib/health-check.ts";
import { Logger, createLogger, log, statusIcon } from "../src/lib/logger.ts";
import { inspectAgent } from "../src/lib/inspect.ts";
import { captureConsole, captureConsoleError, clearSessionEnv, withEnv } from "./helpers.ts";

describe("logger", () => {
  beforeEach(() => {
    clearSessionEnv();
  });

  test("Logger.info emits with checkmark icon", async () => {
    const logs = await captureConsole(() => {
      const logger = new Logger({ level: "info" });
      logger.info("test message");
    });
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("test message");
  });

  test("Logger.error emits with x icon", async () => {
    const logs = await captureConsole(() => {
      const logger = new Logger({ level: "info" });
      logger.error("test error");
    });
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("test error");
  });

  test("Logger.warn emits with warning icon", async () => {
    const logs = await captureConsole(() => {
      const logger = new Logger({ level: "info" });
      logger.warn("test warning");
    });
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("test warning");
  });

  test("Logger.debug is suppressed at info level", async () => {
    const logs = await captureConsole(() => {
      const logger = new Logger({ level: "info" });
      logger.debug("test debug");
    });
    expect(logs.length).toBe(0);
  });

  test("Logger.debug emits at debug level", async () => {
    const logs = await captureConsole(() => {
      const logger = new Logger({ level: "debug" });
      logger.debug("test debug");
    });
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("test debug");
  });

  test("quiet mode suppresses info and warn", async () => {
    const logs = await captureConsole(() => {
      const logger = new Logger({ quiet: true });
      logger.info("test info");
      logger.warn("test warn");
    });
    expect(logs.length).toBe(0);
  });

  test("quiet mode allows errors", async () => {
    const logs = await captureConsole(() => {
      const logger = new Logger({ quiet: true });
      logger.error("test error");
    });
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("test error");
  });

  test("json mode outputs structured agent format", async () => {
    const logs = await captureConsole(() => {
      const logger = new Logger({ json: true, tool: "test-tool" });
      logger.info("test message");
    });
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("test-tool");
    expect(logs[0]).toContain("info");
    expect(logs[0]).toContain("test message");
    expect(logs[0]).toContain("timestamp");
  });

  test("agent context suppresses info output", async () => {
    await withEnv({ KIMI_AGENT_SESSION: "1" }, async () => {
      const logs = await captureConsole(() => {
        const logger = new Logger({ level: "info" });
        logger.info("test info");
      });
      expect(logs.length).toBe(0);
    });
  });

  test("agent context allows errors", async () => {
    await withEnv({ KIMI_AGENT_SESSION: "1" }, async () => {
      const logs = await captureConsoleError(() => {
        const logger = new Logger({ level: "info" });
        logger.error("test error");
      });
      expect(logs.length).toBe(1);
      expect(logs[0]).toContain("test error");
    });
  });

  test("result() logs ok status", async () => {
    const logs = await captureConsole(() => {
      const logger = new Logger({ level: "info" });
      logger.result("test-tool", "ok", "passed");
    });
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("passed");
  });

  test("result() suppresses ok in agent context", async () => {
    await withEnv({ KIMI_AGENT_SESSION: "1" }, async () => {
      const logs = await captureConsole(() => {
        const logger = new Logger({ level: "info" });
        logger.result("test-tool", "ok", "passed");
      });
      expect(logs.length).toBe(0);
    });
  });

  test("section() prints header in human mode", async () => {
    const logs = await captureConsole(() => {
      const logger = new Logger();
      logger.section("Test Section");
    });
    expect(logs.length).toBe(2);
    expect(logs[1]).toContain("Test Section");
  });

  test("section() suppressed in agent context", async () => {
    await withEnv({ KIMI_AGENT_SESSION: "1" }, async () => {
      const logs = await captureConsole(() => {
        const logger = new Logger();
        logger.section("Test Section");
      });
      expect(logs.length).toBe(0);
    });
  });

  test("createLogger parses --json flag", () => {
    const logger = createLogger(["--json"], "test");
    expect(logger.getLogs().length).toBe(0);
  });

  test("createLogger parses --quiet flag", () => {
    const logger = createLogger(["--quiet"], "test");
    expect(logger.getLogs()).toEqual([]);
  });

  test("createLogger enables quiet from KIMI_QUIET env", async () => {
    await withEnv({ KIMI_QUIET: "1" }, async () => {
      const logger = createLogger([], "test");
      const logs = await captureConsole(() => logger.info("hidden"));
      expect(logs.length).toBe(0);
    });
  });

  test("createLogger parses --debug flag", async () => {
    await withEnv({ KIMI_QUIET: undefined }, async () => {
      const logs = await captureConsole(() => {
        const logger = createLogger(["--debug"], "test");
        logger.debug("test debug");
      });
      expect(logs.length).toBe(1);
    });
  });

  test("log() backward compatibility", async () => {
    const logs = await captureConsole(() => log("info", "backward compat"));
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

  test("check() emits structured agent format with schemaVersion", async () => {
    const logs = await captureConsole(() => {
      const logger = new Logger({ json: true, tool: "test-tool" });
      logger.check({ name: "disk", status: "warn", message: "85%", fixable: false });
    });
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("schemaVersion");
    expect(logs[0]).toContain("disk");
    expect(logs[0]).toContain("85%");
  });

  test("check() buffers ok checks in agent context for telemetry", async () => {
    await withEnv({ KIMI_CODE_SESSION: "agent-test" }, async () => {
      const logger = new Logger({ tool: "kimi-doctor" });
      logger.check({ name: "bun", status: "ok", message: "1.3.14", fixable: false });
      logger.check({ name: "disk", status: "error", message: "critical", fixable: false });
      expect(logger.getLogs().length).toBe(2);
      expect(logger.getLogs()[0].check?.name).toBe("bun");
      expect(logger.getLogs()[1].level).toBe("error");
    });
  });

  test("printHealthReport prints section, checks, and summary", async () => {
    const report = aggregateChecks("kimi-doctor", [
      { name: "bun", status: "ok", message: "1.3.14", fixable: false },
      { name: "disk", status: "warn", message: "85%", fixable: true },
    ]);
    const logger = new Logger({ level: "info", tool: "kimi-doctor" });
    const logs = await captureConsole(() => logger.printHealthReport(report));
    expect(logs.some((l) => l.includes("kimi-doctor Doctor"))).toBe(true);
    expect(logs.some((l) => l.includes("bun: 1.3.14"))).toBe(true);
    expect(logs.some((l) => l.includes("disk: 85%"))).toBe(true);
    expect(logs.some((l) => l.includes("0 error(s), 1 warning(s), 1 fixable"))).toBe(true);
    expect(logger.getLogs().length).toBeGreaterThanOrEqual(3);
  });

  test("printHealthReport accepts custom section title", async () => {
    const report = aggregateChecks("kimi-fix", [
      { name: "lockfile", status: "ok", message: "present", fixable: false },
    ]);
    const logger = new Logger();
    const logs = await captureConsole(() => logger.printHealthReport(report, "Custom Section"));
    expect(logs.some((l) => l.includes("Custom Section"))).toBe(true);
    expect(logs.some((l) => l.includes("kimi-fix Doctor"))).toBe(false);
  });

  test("projectBanner prints banner, project line, and blank line", async () => {
    const logs = await captureConsole(() => {
      const logger = new Logger({ level: "info" });
      logger.projectBanner("Kimi Doctor", "my-project", "Health checks");
    });
    expect(logs.some((l) => l.includes("Kimi Doctor"))).toBe(true);
    expect(logs.some((l) => l.includes("Health checks"))).toBe(true);
    expect(logs.some((l) => l.includes("Project: my-project"))).toBe(true);
    expect(logs.some((l) => l === "")).toBe(true);
  });

  test("projectBanner omits project line when project is omitted", async () => {
    const logs = await captureConsole(() => {
      const logger = new Logger({ level: "info" });
      logger.projectBanner("Kimi Doctor");
    });
    expect(logs.some((l) => l.includes("Project:"))).toBe(false);
    expect(logs.some((l) => l.includes("Kimi Doctor"))).toBe(true);
  });

  test("suggest() includes taxonomyId and autoFix in JSON mode", async () => {
    const logger = new Logger({ json: true, tool: "kimi-debug" });
    const logs = await captureConsole(() =>
      logger.suggest("lockfile_issue", "Run kimi-guardian fix", "kimi-guardian fix")
    );
    expect(logs[0]).toBe(
      inspectAgent({
        schemaVersion: 1,
        tool: "kimi-debug",
        level: "info",
        message: "Run kimi-guardian fix",
        timestamp: logger.getLogs()[0]?.timestamp,
        taxonomyId: "lockfile_issue",
        suggestion: "Run kimi-guardian fix",
        autoFix: "kimi-guardian fix",
      })
    );
  });
});
