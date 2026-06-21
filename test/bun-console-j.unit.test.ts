/**
 * Bun v1.3.4: console.log %j format specifier.
 *
 * The %j format specifier outputs the JSON.stringify representation of a value,
 * matching Node.js behavior. Previously, %j was not recognized and left as literal text.
 *
 * Tests run via subprocess to capture real stdout output, since monkey-patching
 * console.log bypasses Bun's internal format specifier processing.
 *
 * @see https://bun.com/blog/bun-v1.3.4#console-log-now-supports-j-format-specifier
 */

import { describe, expect, test } from "bun:test";

async function captureConsoleOutput(code: string): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["bun", "-e", code],
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await Bun.readableStreamToText(proc.stdout);
  await proc.exited;
  return output.trimEnd();
}

async function captureConsoleError(code: string): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["bun", "-e", code],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await Bun.readableStreamToText(proc.stderr);
  await proc.exited;
  return stderr.trimEnd();
}

// ── %j basic ─────────────────────────────────────────────────────────

describe("bun-console-j format specifier", () => {
  test("%j outputs JSON stringified object", async () => {
    const out = await captureConsoleOutput('console.log("%j", { foo: "bar" });');
    expect(out).toBe('{"foo":"bar"}');
  });

  test("%j outputs JSON stringified array", async () => {
    const out = await captureConsoleOutput("console.log('%j', [1, 2, 3]);");
    expect(out).toBe("[1,2,3]");
  });

  test("%j with string value outputs JSON string", async () => {
    const out = await captureConsoleOutput('console.log("%j", "hello");');
    expect(out).toBe('"hello"');
  });

  test("%j with number value", async () => {
    const out = await captureConsoleOutput('console.log("%j", 42);');
    expect(out).toBe("42");
  });

  test("%j with boolean value", async () => {
    const out = await captureConsoleOutput('console.log("%j", true);');
    expect(out).toBe("true");
  });

  test("%j with null value", async () => {
    const out = await captureConsoleOutput('console.log("%j", null);');
    expect(out).toBe("null");
  });
});

// ── %j combined with other specifiers ────────────────────────────────

describe("console.log %j combined with other specifiers", () => {
  test("%j %s combination", async () => {
    const out = await captureConsoleOutput('console.log("%j %s", { status: "ok" }, "done");');
    expect(out).toBe('{"status":"ok"} done');
  });

  test("%j %d combination", async () => {
    const out = await captureConsoleOutput('console.log("%j %d", { count: 5 }, 10);');
    expect(out).toBe('{"count":5} 10');
  });

  test("%s %j combination (order independence)", async () => {
    const out = await captureConsoleOutput('console.log("%s: %j", "result", { ok: true });');
    expect(out).toBe('result: {"ok":true}');
  });

  test("multiple %j specifiers", async () => {
    const out = await captureConsoleOutput('console.log("%j %j", { a: 1 }, { b: 2 });');
    expect(out).toBe('{"a":1} {"b":2}');
  });
});

// ── %j with nested structures ────────────────────────────────────────

describe("console.log %j nested structures", () => {
  test("%j with nested object", async () => {
    const out = await captureConsoleOutput('console.log("%j", { outer: { inner: "value" } });');
    expect(out).toBe('{"outer":{"inner":"value"}}');
  });

  test("%j with array of objects", async () => {
    const out = await captureConsoleOutput('console.log("%j", [{ id: 1 }, { id: 2 }]);');
    expect(out).toBe('[{"id":1},{"id":2}]');
  });

  test("%j with mixed nested structure", async () => {
    const out = await captureConsoleOutput(
      'console.log("%j", { items: [1, "two", { three: 3 }] });'
    );
    expect(out).toBe('{"items":[1,"two",{"three":3}]}');
  });
});

// ── %j on other console methods ──────────────────────────────────────

describe("console %j on other methods", () => {
  test("console.info supports %j", async () => {
    const out = await captureConsoleOutput('console.info("%j", { foo: "bar" });');
    expect(out).toBe('{"foo":"bar"}');
  });

  test("console.debug supports %j", async () => {
    const out = await captureConsoleOutput('console.debug("%j", { debug: true });');
    expect(out).toBe('{"debug":true}');
  });

  test("console.error supports %j", async () => {
    const out = await captureConsoleError('console.error("%j", { error: "failed" });');
    expect(out).toBe('{"error":"failed"}');
  });

  test("console.warn supports %j", async () => {
    const out = await captureConsoleError('console.warn("%j", { warning: "deprecated" });');
    expect(out).toBe('{"warning":"deprecated"}');
  });
});

// ── %j edge cases ────────────────────────────────────────────────────

describe("console.log %j edge cases", () => {
  test("%j with empty object", async () => {
    const out = await captureConsoleOutput('console.log("%j", {});');
    expect(out).toBe("{}");
  });

  test("%j with empty array", async () => {
    const out = await captureConsoleOutput('console.log("%j", []);');
    expect(out).toBe("[]");
  });

  test("%j does not leave literal %j in output", async () => {
    const out = await captureConsoleOutput('console.log("%j", { test: true });');
    expect(out).not.toContain("%j");
  });

  test("plain text without %j is unaffected", async () => {
    const out = await captureConsoleOutput('console.log("hello world");');
    expect(out).toBe("hello world");
  });

  test("%j with no argument outputs literal %j (no value to stringify)", async () => {
    // With no argument, Bun leaves %j as literal text — no value to JSON.stringify
    const out = await captureConsoleOutput('console.log("%j");');
    expect(out).toBe("%j");
  });
});
