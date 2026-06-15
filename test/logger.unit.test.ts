import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Logger, createLogger, log, statusIcon } from "../src/lib/logger.ts";

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

  test("json mode outputs structured JSON", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ json: true, tool: "test-tool" });
    logger.info("test message");

    console.log = originalLog;
    expect(logs.length).toBe(1);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.tool).toBe("test-tool");
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("test message");
    expect(parsed.timestamp).toBeGreaterThan(0);
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
    expect(logger.getLogs().length).toBe(0);
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

  test("check() emits structured JSON with schemaVersion", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ json: true, tool: "test-tool" });
    logger.check({ name: "disk", status: "warn", message: "85%", fixable: false });

    console.log = originalLog;
    expect(logs.length).toBe(1);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.check.name).toBe("disk");
  });

  test("suggest() includes taxonomyId and autoFix in JSON mode", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    const logger = new Logger({ json: true, tool: "kimi-debug" });
    logger.suggest("lockfile_issue", "Run bun install", "bun install");

    console.log = originalLog;
    const parsed = JSON.parse(logs[0]);
    expect(parsed.taxonomyId).toBe("lockfile_issue");
    expect(parsed.autoFix).toBe("bun install");
  });
});
