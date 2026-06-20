/**
 * Bun.spawn, Bun.which, and Bun.randomUUIDv7 correctness tests.
 */
import { describe, expect, test } from "bun:test";

describe("bun-spawn", () => {
  test("Bun.spawn is available", () => {
    expect(typeof Bun.spawn).toBe("function");
  });

  test("Bun.spawnSync returns output", () => {
    const result = Bun.spawnSync(["echo", "hello"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("hello");
  });

  test("Bun.spawn with stdout pipe captures output", async () => {
    const proc = Bun.spawn(["echo", "world"], { stdout: "pipe" });
    const output = await new Response(proc.stdout).text();
    expect(output.trim()).toBe("world");
    expect(await proc.exited).toBe(0);
  });
});

describe("bun-which", () => {
  test("Bun.which finds bun", () => {
    expect(Bun.which("bun")).not.toBeNull();
  });

  test("Bun.which returns null for nonexistent binary", () => {
    expect(Bun.which("nonexistent-binary-xyz")).toBeNull();
  });
});

describe("bun-random-uuid", () => {
  test("Bun.randomUUIDv7 returns version-7 UUID", () => {
    const uuid = Bun.randomUUIDv7();
    expect(typeof uuid).toBe("string");
    expect(uuid.length).toBe(36);
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}/);
  });

  test("Bun.randomUUIDv7 produces unique values", () => {
    const a = Bun.randomUUIDv7();
    const b = Bun.randomUUIDv7();
    expect(a).not.toBe(b);
  });
});
