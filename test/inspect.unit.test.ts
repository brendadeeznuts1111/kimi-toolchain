import { describe, expect, test } from "bun:test";
import {
  customInspect,
  deepEqual,
  deepEqualStrict,
  formatTable,
  inspectAgent,
  inspectHuman,
  inspectStream,
  stripANSI,
  wrapAnsi,
} from "../src/lib/inspect.ts";

describe("inspect", () => {
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
  });

  describe("inspectHuman", () => {
    test("returns a string", () => {
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
    test("is a symbol", () => {
      expect(typeof customInspect).toBe("symbol");
    });

    test("can be used as a property key", () => {
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
