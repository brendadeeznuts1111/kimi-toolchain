import { describe, expect, test } from "bun:test";
import { parseCliFlags, createMachineWriter } from "../src/lib/cli-contract.ts";

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

    test("strict mode rejects unknown flags", () => {
      const argv = ["bun", "kimi-doctor", "--unknown-flag"];
      expect(() => parseCliFlags(argv, "kimi-doctor", { strict: true })).toThrow();
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
    test("writeJson emits valid JSON to stdout", () => {
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
        writer.writeJson({ tool: "kimi-doctor", ok: true });
        expect(stdout.data).toHaveLength(1);
        expect(JSON.parse(stdout.data[0])).toEqual({ tool: "kimi-doctor", ok: true });
        expect(stderr.data).toHaveLength(0);
      } finally {
        stdout.restore();
        stderr.restore();
      }
    });

    test("writeJsonl emits multiple JSON lines to stdout", () => {
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
        writer.writeJsonl([{ a: 1 }, { b: 2 }]);
        expect(stdout.data).toHaveLength(2);
        expect(JSON.parse(stdout.data[0])).toEqual({ a: 1 });
        expect(JSON.parse(stdout.data[1])).toEqual({ b: 2 });
        expect(stderr.data).toHaveLength(0);
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
