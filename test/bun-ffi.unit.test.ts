/**
 * Bun.FFI regression test.
 *
 * Bun's FFI allows calling native C functions without node-gyp or N-API.
 * This test verifies FFI availability and basic symbol loading.
 */
import { describe, expect, test } from "bun:test";
import { dlopen } from "bun:ffi";

describe("bun-ffi", () => {
  test("dlopen loads libc", () => {
    const lib = dlopen("libSystem.dylib", {
      getpid: { returns: "int", args: [] },
    });
    expect(lib.symbols.getpid).toBeDefined();
    const pid = lib.symbols.getpid();
    expect(typeof pid).toBe("number");
    expect(pid).toBeGreaterThan(0);
  });

  test("dlopen requires at least one symbol", () => {
    expect(() => {
      dlopen("libSystem.dylib", {});
    }).toThrow("Expected at least one symbol");
  });

  test("Bun.FFI static member exists", () => {
    // Bun.FFI provides linkSymbols for dynamic loading
    const ffi = (Bun as unknown as { FFI: { linkSymbols: unknown } }).FFI;
    expect(typeof ffi).toBe("object");
    expect(typeof ffi.linkSymbols).toBe("function");
  });
});
