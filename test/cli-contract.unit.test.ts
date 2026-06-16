import { describe, expect, test } from "bun:test";
import { parseCliFlags, createMachineWriter, CliContractError } from "../src/lib/cli-contract.ts";
import { inspectAgent } from "../src/lib/inspect.ts";

function captureStdout(): { data: string[]; restore: () => void } {
  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const data: string[] = [];
  console.log = (...args: unknown[]) => {
    data.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  process.stdout.write = (chunk: string | Uint8Array) => {
    data.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  return {
    data,
    restore: () => {
      console.log = originalLog;
      process.stdout.write = originalWrite;
    },
  };
}

function captureStderr(): { data: string[]; restore: () => void } {
  const original = console.error;
  const originalWarn = console.warn;
  const data: string[] = [];
  console.error = (msg: string) => data.push(msg);
  console.warn = (msg: string) => data.push(msg);
  return {
    data,
    restore: () => {
      console.error = original;
      console.warn = originalWarn;
    },
  };
}

function captureStderrWrite(): { data: string[]; restore: () => void } {
  const original = process.stderr.write.bind(process.stderr);
  const data: string[] = [];
  process.stderr.write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
    data.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    const callback = rest.find((r) => typeof r === "function") as (() => void) | undefined;
    if (callback) callback();
    return true;
  };
  return {
    data,
    restore: () => {
      process.stderr.write = original;
    },
  };
}

describe("cli-contract", () => {
  describe("parse-cli-flags", () => {
    test("parses common flags from argv", () => {
      const argv = ["bun", "kimi-doctor", "--json", "--debug", "--bail", "--step-budget"];
      const flags = parseCliFlags(argv, "kimi-doctor");
      expect(flags.json).toBe(true);
      expect(flags.debug).toBe(true);
      expect(flags.bail).toBe(true);
      expect(flags.stepBudget).toBe(true);
      expect(flags.quiet).toBe(true); // json implies quiet
    });

    test("parses --timeout value", () => {
      const argv = ["bun", "kimi-doctor", "--timeout", "5000"];
      const flags = parseCliFlags(argv, "kimi-doctor");
      expect(flags.timeout).toBe(5000);
    });

    test("ignores missing --timeout value", () => {
      const argv = ["bun", "kimi-doctor", "--timeout", "--other"];
      const flags = parseCliFlags(argv, "kimi-doctor");
      expect(flags.timeout).toBeUndefined();
    });

    test("collects positional args", () => {
      const argv = ["bun", "kimi-doctor", "score", "--json", "my-project"];
      const flags = parseCliFlags(argv, "kimi-doctor");
      expect(flags.positional).toEqual(["score", "my-project"]);
    });

    test("falls back to KIMI_JSON env var", () => {
      Bun.env.KIMI_JSON = "1";
      try {
        const flags = parseCliFlags(["bun", "kimi-doctor"], "kimi-doctor");
        expect(flags.json).toBe(true);
        expect(flags.quiet).toBe(true);
      } finally {
        delete Bun.env.KIMI_JSON;
      }
    });

    test("falls back to KIMI_TIMEOUT_MS env var", () => {
      Bun.env.KIMI_TIMEOUT_MS = "10000";
      try {
        const flags = parseCliFlags(["bun", "kimi-doctor"], "kimi-doctor");
        expect(flags.timeout).toBe(10000);
      } finally {
        delete Bun.env.KIMI_TIMEOUT_MS;
      }
    });

    test("argv flags override env vars", () => {
      Bun.env.KIMI_TIMEOUT_MS = "10000";
      try {
        const flags = parseCliFlags(["bun", "kimi-doctor", "--timeout", "2500"], "kimi-doctor");
        expect(flags.timeout).toBe(2500);
      } finally {
        delete Bun.env.KIMI_TIMEOUT_MS;
      }
    });

    test("invalid --timeout value warns on stderr and does not use env fallback", () => {
      Bun.env.KIMI_TIMEOUT_MS = "10000";
      const stderr = captureStderrWrite();
      try {
        const flags = parseCliFlags(["bun", "kimi-doctor", "--timeout", "abc"], "kimi-doctor");
        expect(flags.timeout).toBeUndefined();
        expect(stderr.data.join("\n")).toContain('Invalid --timeout value "abc"');
      } finally {
        delete Bun.env.KIMI_TIMEOUT_MS;
        stderr.restore();
      }
    });

    test("invalid --timeout numeric zero warns on stderr", () => {
      const stderr = captureStderrWrite();
      try {
        const flags = parseCliFlags(["bun", "kimi-doctor", "--timeout", "0"], "kimi-doctor");
        expect(flags.timeout).toBeUndefined();
        expect(stderr.data.join("\n")).toContain('Invalid --timeout value "0"');
      } finally {
        stderr.restore();
      }
    });

    test("env fallback precedence: env values apply when argv omits the flag", () => {
      Bun.env.KIMI_DEBUG = "1";
      Bun.env.KIMI_BAIL = "true";
      try {
        const flags = parseCliFlags(["bun", "kimi-doctor"], "kimi-doctor");
        expect(flags.debug).toBe(true);
        expect(flags.bail).toBe(true);
      } finally {
        delete Bun.env.KIMI_DEBUG;
        delete Bun.env.KIMI_BAIL;
      }
    });

    test("strict mode rejects unknown flags with taxonomy-coded error", () => {
      const argv = ["bun", "kimi-doctor", "--unknown-flag"];
      let thrown: unknown;
      try {
        parseCliFlags(argv, "kimi-doctor", { strict: true });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(CliContractError);
      const error = thrown as CliContractError;
      expect(error.toolName).toBe("kimi-doctor");
      expect(error.taxonomyId).toBe("cli_invalid_flag");
      expect(error.unknownFlag).toBe("--unknown-flag");
      expect(error.message).toContain("Unknown flag --unknown-flag");
    });

    test("strict mode suggests the closest valid flag", () => {
      const argv = ["bun", "kimi-doctor", "--jsn"];
      let thrown: unknown;
      try {
        parseCliFlags(argv, "kimi-doctor", { strict: true });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(CliContractError);
      const error = thrown as CliContractError;
      expect(error.message).toContain("Did you mean --json?");
      expect(error.suggestions).toEqual(["--json"]);
    });

    test("allowedFlags permits tool-specific flags in strict mode", () => {
      const argv = ["bun", "kimi-doctor", "--fix", "--workspace"];
      const flags = parseCliFlags(argv, "kimi-doctor", {
        strict: true,
        allowedFlags: ["--fix", "--workspace"],
      });
      expect(flags.positional).toEqual(["--fix", "--workspace"]);
    });
  });

  describe("create-machine-writer", () => {
    test("writeJson emits structured agent format to stdout with schema envelope", () => {
      const stdout = captureStdout();
      const stderr = captureStderr();
      try {
        const writer = createMachineWriter(
          {
            json: true,
            quiet: true,
            debug: false,
            bail: false,
            stepBudget: false,
            positional: [],
          },
          "test-tool"
        );
        writer.writeJson({ ok: true });
        expect(stdout.data).toHaveLength(1);
        expect(stdout.data[0]).toBe(
          inspectAgent({ schemaVersion: 1, tool: "test-tool", ok: true }) + "\n"
        );
        expect(stderr.data).toHaveLength(0);
      } finally {
        stdout.restore();
        stderr.restore();
      }
    });

    test("writeJsonl emits multiple agent-format lines to stdout with schema envelope", () => {
      const stdout = captureStdout();
      const stderr = captureStderr();
      try {
        const writer = createMachineWriter(
          {
            json: true,
            quiet: true,
            debug: false,
            bail: false,
            stepBudget: false,
            positional: [],
          },
          "test-tool"
        );
        writer.writeJsonl([{ a: 1 }, { b: 2 }]);
        expect(stdout.data).toHaveLength(2);
        expect(stdout.data[0]).toBe(
          inspectAgent({ schemaVersion: 1, tool: "test-tool", a: 1 }) + "\n"
        );
        expect(stdout.data[1]).toBe(
          inspectAgent({ schemaVersion: 1, tool: "test-tool", b: 2 }) + "\n"
        );
        expect(stderr.data).toHaveLength(0);
      } finally {
        stdout.restore();
        stderr.restore();
      }
    });

    test("writeJsonSchema emits schema-named agent-format envelope", () => {
      const stdout = captureStdout();
      const stderr = captureStderr();
      try {
        const writer = createMachineWriter(
          {
            json: true,
            quiet: true,
            debug: false,
            bail: false,
            stepBudget: false,
            positional: [],
          },
          "test-tool"
        );
        writer.writeJsonSchema("health-report", { checks: [{ status: "ok" }] });
        expect(stdout.data).toHaveLength(1);
        expect(stdout.data[0]).toBe(
          inspectAgent({
            schemaVersion: 1,
            tool: "test-tool",
            schemaName: "health-report",
            payload: { checks: [{ status: "ok" }] },
          }) + "\n"
        );
        expect(stderr.data).toHaveLength(0);
      } finally {
        stdout.restore();
        stderr.restore();
      }
    });

    test("json mode keeps stdout exclusively structured agent format and routes human output to stderr", () => {
      const stdout = captureStdout();
      const stderr = captureStderr();
      try {
        const writer = createMachineWriter(
          {
            json: true,
            quiet: true,
            debug: false,
            bail: false,
            stepBudget: false,
            positional: [],
          },
          "test-tool"
        );
        writer.writeJson({ stage: "start" });
        writer.writeJsonl([{ stage: "middle" }]);
        writer.info("info line");
        writer.warn("warn line");
        writer.error("error line");

        // Every stdout line must carry the contract envelope in agent format.
        expect(stdout.data).toHaveLength(2);
        expect(stdout.data[0]).toBe(
          inspectAgent({ schemaVersion: 1, tool: "test-tool", stage: "start" }) + "\n"
        );
        expect(stdout.data[1]).toBe(
          inspectAgent({ schemaVersion: 1, tool: "test-tool", stage: "middle" }) + "\n"
        );

        // Human output must not leak to stdout.
        expect(stdout.data.some((line) => line.includes("info line"))).toBe(false);
        expect(stdout.data.some((line) => line.includes("warn line"))).toBe(false);
        expect(stdout.data.some((line) => line.includes("error line"))).toBe(false);

        // Errors go to stderr; non-errors are suppressed in quiet/json mode.
        expect(stderr.data).not.toContain("info line");
        expect(stderr.data).not.toContain("warn line");
        expect(stderr.data.some((line) => line.includes("error line"))).toBe(true);
      } finally {
        stdout.restore();
        stderr.restore();
      }
    });

    test("human output goes to stdout in normal mode", () => {
      const stdout = captureStdout();
      const stderr = captureStderr();
      try {
        const writer = createMachineWriter({
          json: false,
          quiet: false,
          debug: false,
          bail: false,
          stepBudget: false,
          positional: [],
        });
        writer.info("info line");
        writer.warn("warn line");
        writer.error("error line");
        expect(stderr.data).toHaveLength(0);
        expect(stdout.data).toContain("  ✓ info line");
        expect(stdout.data).toContain("  ⚠ warn line");
        expect(stdout.data).toContain("  ✗ error line");
      } finally {
        stdout.restore();
        stderr.restore();
      }
    });

    test("json mode suppresses non-error human output but keeps errors on stderr", () => {
      const stdout = captureStdout();
      const stderr = captureStderr();
      try {
        const writer = createMachineWriter({
          json: true,
          quiet: true,
          debug: false,
          bail: false,
          stepBudget: false,
          positional: [],
        });
        writer.info("info line");
        writer.warn("warn line");
        writer.error("error line");
        expect(stdout.data).toHaveLength(0);
        expect(stderr.data).not.toContain("info line");
        expect(stderr.data).not.toContain("warn line");
        expect(stderr.data).toContain("  ✗ error line");
      } finally {
        stdout.restore();
        stderr.restore();
      }
    });

    test("quiet mode suppresses non-error human output", () => {
      const stdout = captureStdout();
      const stderr = captureStderr();
      try {
        const writer = createMachineWriter({
          json: false,
          quiet: true,
          debug: false,
          bail: false,
          stepBudget: false,
          positional: [],
        });
        writer.info("info line");
        writer.warn("warn line");
        writer.error("error line");
        expect(stdout.data).not.toContain("info line");
        expect(stdout.data).not.toContain("warn line");
        expect(stdout.data).toContain("  ✗ error line");
        expect(stderr.data).toHaveLength(0);
      } finally {
        stdout.restore();
        stderr.restore();
      }
    });

    test("shared logger emits human output to stdout in normal mode and buffers for telemetry", () => {
      const stdout = captureStdout();
      const stderr = captureStderr();
      try {
        const writer = createMachineWriter({
          json: false,
          quiet: false,
          debug: false,
          bail: false,
          stepBudget: false,
          positional: [],
        });
        writer.logger.info("buffered info");
        writer.logger.error("buffered error");
        expect(stderr.data).toHaveLength(0);
        expect(stdout.data).toContain("  ✓ buffered info");
        expect(stdout.data).toContain("  ✗ buffered error");
        const logs = writer.logger.getLogs();
        expect(logs.map((l) => l.message)).toContain("buffered info");
        expect(logs.map((l) => l.message)).toContain("buffered error");
      } finally {
        stdout.restore();
        stderr.restore();
      }
    });
  });
});
