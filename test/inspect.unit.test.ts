import { describe, expect, test } from "bun:test";
import {
  configureInspect,
  customInspect,
  deepEqual,
  deepEqualStrict,
  formatTable,
  inspectAgent,
  inspectHuman,
  inspectStream,
  stripANSI,
  sliceAnsi,
  truncateTerminal,
  wrapAnsi,
} from "../src/lib/inspect.ts";

describe("inspect", () => {
  describe("configureInspect", () => {
    function currentInspectOptions(): Record<string, unknown> | undefined {
      return (Bun.inspect as unknown as { options?: Record<string, unknown> }).options;
    }

    function withInspectOptions<T>(fn: () => T): T {
      const original = currentInspectOptions();
      try {
        return fn();
      } finally {
        const inspect = Bun.inspect as unknown as { options?: Record<string, unknown> };
        if (original) inspect.options = { ...original };
        else delete inspect.options;
      }
    }

    test("auto preset uses TTY development defaults", () => {
      withInspectOptions(() => {
        const config = configureInspect("auto", { env: { NODE_ENV: "development" }, isTTY: true });
        expect(config).toMatchObject({
          preset: "auto",
          depth: 5,
          colors: true,
          compact: false,
          sorted: true,
          maxArrayLength: Infinity,
          showHidden: false,
        });
        expect(currentInspectOptions()?.depth).toBe(5);
      });
    });

    test("auto preset uses non-TTY defaults", () => {
      withInspectOptions(() => {
        const config = configureInspect("auto", { env: {}, isTTY: false });
        expect(config).toMatchObject({
          depth: 4,
          colors: false,
          compact: true,
          sorted: true,
          maxArrayLength: 100,
          showHidden: false,
        });
      });
    });

    test("auto preset uses production defaults before TTY defaults", () => {
      withInspectOptions(() => {
        const config = configureInspect("auto", { env: { NODE_ENV: "production" }, isTTY: true });
        expect(config).toMatchObject({
          depth: 2,
          colors: false,
          compact: true,
          sorted: false,
          maxArrayLength: 30,
          showHidden: false,
        });
      });
    });

    test("DEBUG_INSPECT forces debug preset", () => {
      withInspectOptions(() => {
        const config = configureInspect("production", {
          env: { NODE_ENV: "production", DEBUG_INSPECT: "yes" },
          isTTY: true,
        });
        expect(config).toMatchObject({
          preset: "debug",
          forcedDebug: true,
          depth: Infinity,
          colors: true,
          compact: false,
          sorted: true,
          maxArrayLength: Infinity,
          showHidden: true,
        });
      });
    });

    test("caller overrides win last", () => {
      withInspectOptions(() => {
        const config = configureInspect("production", {
          env: { NODE_ENV: "production" },
          isTTY: false,
          depth: 3,
          sorted: true,
        });
        expect(config.depth).toBe(3);
        expect(config.sorted).toBe(true);
        expect(currentInspectOptions()?.depth).toBe(3);
        expect(currentInspectOptions()?.sorted).toBe(true);
      });
    });

    test("configures bare Bun.inspect calls while preserving per-call overrides", () => {
      withInspectOptions(() => {
        const nested = { a: { b: { c: { d: true } } } };
        configureInspect("production", { env: { NODE_ENV: "production" }, isTTY: false });

        expect(Bun.inspect(nested)).toMatch(/c:\s+\[Object/);
        expect(Bun.inspect(nested, { depth: 3 })).toContain("d: true");
      });
    });
  });

  describe("inspectAgent", () => {
    test("returns deterministic output for the same object", () => {
      const obj = { b: 2, a: 1, c: [3, 2, 1] };
      const first = inspectAgent(obj);
      const second = inspectAgent(obj);
      expect(first).toBe(second);
      expect(first).toContain("a");
      expect(first).toContain("b");
      expect(first).toContain("c");
    });

    test("sorts object keys by default", () => {
      const output = inspectAgent({ z: 1, a: 2 });
      expect(output.indexOf("a")).toBeLessThan(output.indexOf("z"));
    });

    test("defaults disable colors", () => {
      const output = inspectAgent({ color: "red" });
      expect(output).not.toContain("\u001b[");
    });

    test("serializes nested structures with default depth", () => {
      const obj = { level1: { level2: { level3: { level4: { level5: { deep: true } } } } } };
      const output = inspectAgent(obj);
      expect(output).toContain("level1");
      expect(typeof output).toBe("string");
    });

    test("represents plain objects faithfully", () => {
      const obj = { schemaVersion: 1, tool: "kimi-toolchain", level: "info", message: "ok" };
      const output = inspectAgent(obj);
      expect(output).toContain("schemaVersion");
      expect(output).toContain("kimi-toolchain");
      expect(output).toContain("info");
      expect(output).toContain("ok");
    });

    test("defaults to compact JSONL-compatible output", () => {
      const output = inspectAgent({ a: 1, b: 2 });
      expect(output).not.toContain("\n");
      expect(JSON.parse(output)).toEqual({ a: 1, b: 2 });
    });

    test("pretty-prints when compact is false", () => {
      const output = inspectAgent({ a: 1 }, { compact: false });
      expect(output).toContain("\n");
      expect(JSON.parse(output)).toEqual({ a: 1 });
    });

    test("serializes BigInt values as strings", () => {
      const output = inspectAgent({ value: 9007199254740993n });
      expect(output).toContain('"9007199254740993n"');
      expect(JSON.parse(output)).toEqual({ value: "9007199254740993n" });
    });

    test("replaces circular references with [Circular]", () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj;
      const output = inspectAgent(obj);
      expect(output).toContain('"self":"[Circular]"');
      expect(JSON.parse(output)).toEqual({ a: 1, self: "[Circular]" });
    });

    test("truncates values beyond depth", () => {
      const obj = { level1: { level2: { level3: { level4: { keep: true } } } } };
      const output = inspectAgent(obj, { depth: 2 });
      const parsed = JSON.parse(output) as Record<string, unknown>;
      const level1 = parsed.level1 as Record<string, unknown>;
      const level2 = level1.level2 as Record<string, unknown>;
      expect(level2.level3).toBe("[Object]");
    });

    test("always disables colors regardless of caller option", () => {
      const output = inspectAgent({ color: "red" }, { colors: false });
      expect(output).not.toContain("\u001b[");
    });

    test("serializes dates as ISO strings", () => {
      const date = new Date("2024-01-15T00:00:00.000Z");
      const output = inspectAgent({ date });
      expect(JSON.parse(output)).toEqual({ date: "2024-01-15T00:00:00.000Z" });
    });
  });

  describe("inspectHuman", () => {
    test("produces string output containing the inspected object's keys", () => {
      const output = inspectHuman({ hello: "world" });
      expect(typeof output).toBe("string");
      expect(output).toContain("hello");
    });

    test("sorts keys by default", () => {
      const output = inspectHuman({ z: 1, a: 2 }, { colors: false });
      expect(output.indexOf("a")).toBeLessThan(output.indexOf("z"));
    });
  });

  describe("formatTable", () => {
    test("returns a string containing expected headers", () => {
      const rows = [
        { name: "alpha", status: "ok" },
        { name: "beta", status: "warn" },
      ];
      const output = formatTable(rows, ["name", "status"]);
      expect(typeof output).toBe("string");
      expect(output).toContain("name");
      expect(output).toContain("status");
      expect(output).toContain("alpha");
      expect(output).toContain("beta");
    });

    test("handles empty arrays", () => {
      const output = formatTable([], ["name"]);
      expect(typeof output).toBe("string");
    });
  });

  describe("deepEqual", () => {
    test("returns true for structurally equal objects", () => {
      expect(deepEqual({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 })).toBe(true);
    });

    test("returns false for different objects", () => {
      expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    });
  });

  describe("deepEqualStrict", () => {
    test("returns true for identical primitives", () => {
      expect(deepEqualStrict(1, 1)).toBe(true);
    });

    test("distinguishes 0 and -0 in strict mode", () => {
      expect(deepEqualStrict(0, -0)).toBe(false);
    });
  });

  describe("stripANSI", () => {
    test("removes ANSI escape codes", () => {
      const colored = "\u001b[31mred\u001b[0m";
      expect(stripANSI(colored)).toBe("red");
    });

    test("leaves plain text unchanged", () => {
      expect(stripANSI("plain text")).toBe("plain text");
    });
  });

  describe("sliceAnsi", () => {
    test("truncates wide text with ellipsis at display width", () => {
      const truncated = sliceAnsi("你好世界", 0, 5, "…");
      expect(truncated.endsWith("…")).toBe(true);
    });

    test("preserves ANSI codes when slicing", () => {
      const colored = "\u001b[31mhello\u001b[0m";
      expect(sliceAnsi(colored, 1, 4)).toContain("ell");
    });
  });

  describe("truncateTerminal", () => {
    test("leaves short strings unchanged", () => {
      expect(truncateTerminal("hello", 10)).toBe("hello");
    });

    test("truncates by display width with default ellipsis", () => {
      const truncated = truncateTerminal("你好世界", 5);
      expect(truncated.endsWith("…")).toBe(true);
    });

    test("respects custom ellipsis", () => {
      expect(truncateTerminal("hello world", 8, "...")).toBe("hello...");
    });
  });

  describe("wrapAnsi", () => {
    test("wraps long lines at word boundaries", () => {
      const text = "hello world this is a long line of text";
      const wrapped = wrapAnsi(text, 10);
      expect(wrapped).toContain("\n");
    });

    test("leaves short lines unchanged", () => {
      expect(wrapAnsi("short", 20)).toBe("short");
    });
  });

  describe("customInspect", () => {
    test("exposes a Symbol that can be registered as a custom inspect function", () => {
      expect(typeof customInspect).toBe("symbol");
    });

    test("works as a Symbol-keyed method on objects for custom inspect output", () => {
      const obj = {
        [customInspect]() {
          return "custom";
        },
      };
      expect(inspectHuman(obj, { colors: false })).toBe("custom");
    });
  });

  describe("inspectStream", () => {
    test("reads a ReadableStream to completion", async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("hello "));
          controller.enqueue(encoder.encode("world"));
          controller.close();
        },
      });
      const text = await inspectStream(stream);
      expect(text).toBe("hello world");
    });
  });
});
