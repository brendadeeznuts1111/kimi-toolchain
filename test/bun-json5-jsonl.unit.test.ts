/**
 * Bun.JSON5 and Bun.JSONL correctness regression test.
 *
 * Bun v1.3.7 introduced native JSON5 (comments, trailing commas, unquoted keys)
 * and Bun.JSONL (newline-delimited JSON parsing + streaming).
 *
 * @see https://bun.com/blog/bun-v1.3.7
 */
import { describe, expect, test } from "bun:test";

const JSON5_CONFIG = `{
  // Database configuration
  host: 'localhost',
  port: 5432,
  ssl: true,  // trailing comma
  hex: 0xDEAD,
}`;

const JSONL_INPUT = `{"name":"Alice"}
{"name":"Bob","age":30}
`;

describe("bun-json5", () => {
  test("Bun.JSON5 is available", () => {
    expect(typeof Bun.JSON5).toBe("object");
  });

  test("Bun.JSON5.parse handles comments and trailing commas", () => {
    const parsed = Bun.JSON5.parse(JSON5_CONFIG);
    expect(parsed.host).toBe("localhost");
    expect(parsed.port).toBe(5432);
    expect(parsed.ssl).toBe(true);
    expect(parsed.hex).toBe(0xdead);
  });

  test("Bun.JSON5.stringify produces valid output", () => {
    const output = Bun.JSON5.stringify({ name: "app", version: 1 });
    expect(typeof output).toBe("string");
    expect(output).toContain("app");
  });

  test("invalid JSON5 throws", () => {
    expect(() => Bun.JSON5.parse("{invalid")).toThrow();
  });
});

describe("bun-jsonl", () => {
  test("Bun.JSONL is available", () => {
    expect(typeof Bun.JSONL).toBe("object");
  });

  test("Bun.JSONL.parse returns array of values", () => {
    const results = Bun.JSONL.parse(JSONL_INPUT);
    expect(results).toEqual([{ name: "Alice" }, { name: "Bob", age: 30 }]);
  });

  test("Bun.JSONL.parse handles Uint8Array", () => {
    const buffer = new TextEncoder().encode('{"a":1}\n{"b":2}\n');
    const records = Bun.JSONL.parse(buffer);
    expect(records).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("Bun.JSONL.parseChunk handles partial input", () => {
    const result = Bun.JSONL.parseChunk('{"id":1}\n{"id":2}\n{"id":3');
    expect(result.values).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.read).toBe(17); // chars consumed
    expect(result.done).toBe(false); // incomplete value remains
    expect(result.error).toBeNull();
  });
});
