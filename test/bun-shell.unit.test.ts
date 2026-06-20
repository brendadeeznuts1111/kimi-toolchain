/**
 * Bun Shell ($ template literal) regression test.
 *
 * Bun v1.3.7 fixes: ls -l format, cwd(".") ENOENT, shell init crashes.
 */
import { describe, expect, test } from "bun:test";
import { $ } from "bun";

describe("bun-shell", () => {
  test("$ echo returns captured output", async () => {
    const result = await $`echo hello`.quiet();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("hello");
  });

  test("$ ls . does not error", async () => {
    const result = await $`ls .`.quiet().nothrow();
    expect(result.exitCode).toBe(0);
  });

  test("$.cwd() with path returns result", async () => {
    const result = await $`pwd`.cwd("/tmp").quiet();
    expect(result.stdout.toString().trim()).toBe("/tmp");
  });

  test("multiple commands in sequence", async () => {
    const a = await $`echo foo`.quiet();
    const b = await $`echo bar`.quiet();
    expect(a.stdout.toString().trim()).toBe("foo");
    expect(b.stdout.toString().trim()).toBe("bar");
  });
});
