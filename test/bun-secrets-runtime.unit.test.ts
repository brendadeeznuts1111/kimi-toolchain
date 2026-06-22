import { describe, expect, test } from "bun:test";

// Runtime validation of the Bun.secrets keychain API.
// Adapted from the upstream Bun harness to kimi-toolchain conventions.
// These tests intentionally hit the OS keychain, so they are skipped in CI
// on non-Windows platforms to avoid unattended machine failures.

const isCI = Boolean(Bun.env.CI || Bun.env.GITHUB_ACTIONS);
const isWindows = process.platform === "win32";
const hasBunSecrets = typeof Bun.secrets === "object" && Bun.secrets !== null;
const skipRuntime = isCI && !isWindows ? true : !hasBunSecrets;

describe("bun-secrets-runtime", () => {
  function uniqueService(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  test.skipIf(skipRuntime)("Bun.secrets basic CRUD", async () => {
    const service = uniqueService("bun-test-crud");
    const name = "test-key";
    const value = "test-value-" + Date.now();

    try {
      await Bun.secrets.set({ service, name, value });
      const got = await Bun.secrets.get({ service, name });
      expect(got).toBe(value);

      const updated = "updated-value-" + Date.now();
      await Bun.secrets.set({ service, name, value: updated });
      const gotUpdated = await Bun.secrets.get({ service, name });
      expect(gotUpdated).toBe(updated);

      const deleted = await Bun.secrets.delete({ service, name });
      expect(deleted).toBe(true);
      const missing = await Bun.secrets.get({ service, name });
      expect(missing).toBeNull();
    } finally {
      await Bun.secrets.delete({ service, name }).catch(() => {});
    }
  });

  test.skipIf(skipRuntime)("Bun.secrets handles special characters", async () => {
    const service = uniqueService("bun-test-special");
    const name = "name@example.com";
    const value = "p@$$w0rd!#$%^&*()_+-=[]{}|;':\",./<>?`~\n\t\r";

    try {
      await Bun.secrets.set({ service, name, value });
      const got = await Bun.secrets.get({ service, name });
      expect(got).toBe(value);
    } finally {
      await Bun.secrets.delete({ service, name }).catch(() => {});
    }
  });

  test.skipIf(skipRuntime)("Bun.secrets handles unicode", async () => {
    const service = uniqueService("bun-test-unicode");
    const name = "🔑-ключ-キー";
    const value = "你好，世界！👋🌍 café \u0000 \u001F";

    try {
      await Bun.secrets.set({ service, name, value });
      const got = await Bun.secrets.get({ service, name });
      expect(got).toBe(value);
    } finally {
      await Bun.secrets.delete({ service, name }).catch(() => {});
    }
  });

  test.skipIf(skipRuntime)("Bun.secrets returns null for missing secrets", async () => {
    const service = uniqueService("bun-test-missing");
    const name = "does-not-exist";

    const got = await Bun.secrets.get({ service, name });
    expect(got).toBeNull();
  });

  test.skipIf(skipRuntime)("Bun.secrets error handling", async () => {
    // Bun.secrets methods are async on valid input but throw synchronously on invalid
    // arguments. Assert the synchronous throw with a thunk wrapper.

    // @ts-expect-error - testing invalid input
    expect(() => Bun.secrets.get()).toThrow("secrets.get requires an options object");

    // @ts-expect-error - testing invalid input
    expect(() => Bun.secrets.get("not an object")).toThrow("Expected options to be an object");

    // @ts-expect-error - testing invalid input
    expect(() => Bun.secrets.get({ name: "test" })).toThrow(
      "Expected service and name to be strings"
    );

    // @ts-expect-error - testing invalid input
    expect(() => Bun.secrets.get({ service: "test" })).toThrow(
      "Expected service and name to be strings"
    );

    // @ts-expect-error - testing invalid input
    expect(() => Bun.secrets.set({ service: "test", name: "test" })).toThrow(
      "Expected 'value' to be a string"
    );

    // @ts-expect-error - testing invalid input
    expect(() => Bun.secrets.set({ service: "test", name: "test", value: 123 })).toThrow(
      "Expected 'value' to be a string"
    );

    // @ts-expect-error - testing invalid input
    expect(() => Bun.secrets.delete()).toThrow("requires an options object");
  });

  test("Bun.secrets API is available", () => {
    expect(Bun.secrets).toBeDefined();
    expect(typeof Bun.secrets.get).toBe("function");
    expect(typeof Bun.secrets.set).toBe("function");
    expect(typeof Bun.secrets.delete).toBe("function");
  });
});
