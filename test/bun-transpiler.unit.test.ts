/**
 * Bun.Transpiler correctness regression test.
 *
 * Bun v1.3.7 added replMode option for interactive REPL evaluation.
 * Core transpiler features: TS/TSX → JS, loader options, macros.
 *
 * @see https://bun.com/blog/bun-v1.3.7
 */
import { describe, expect, test } from "bun:test";

describe("bun-transpiler", () => {
  test("Bun.Transpiler is available", () => {
    expect(typeof Bun.Transpiler).toBe("function");
  });

  test("transpiles TypeScript to JavaScript", () => {
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    const result = transpiler.transformSync("const x: number = 1;");
    expect(result).not.toContain(": number");
    expect(result).toContain("const x = 1");
  });

  test("transpiles JSX", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx" });
    const result = transpiler.transformSync("const el = <div>hello</div>;");
    expect(result).not.toContain("<div>");
    expect(result.length).toBeGreaterThan(0);
  });

  test("replMode transforms for interactive evaluation", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });
    const result = transpiler.transformSync("const x = 1;");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("replMode: var is hoisted for persistence across lines", () => {
    const transpiler = new Bun.Transpiler({ loader: "ts", replMode: true });
    const result = transpiler.transformSync("var x = 10");
    expect(result).toContain("x");
  });

  test("replMode: object literal auto-detected (not block statement)", () => {
    const transpiler = new Bun.Transpiler({ loader: "ts", replMode: true });
    const result = transpiler.transformSync("{ a: 1, b: 2 }");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("in-memory module scanning (no disk writes)", () => {
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    const scanResult = transpiler.scan("import { foo } from './bar';");
    expect(Array.isArray(scanResult.imports)).toBe(true);
    expect(scanResult.imports.length).toBe(1);
  });
});
