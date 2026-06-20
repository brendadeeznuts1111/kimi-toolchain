/**
 * Bun.build correctness regression test.
 *
 * Bun's native bundler handles TypeScript, JSX, and bundling.
 * This test verifies basic build correctness and the bundler API.
 */
import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import { makeDir, removePath, writeText } from "./helpers.ts";

const FIXTURE_DIR = join(import.meta.dir, ".tmp-build-fixtures");

describe("bun-build", () => {
  test("Bun.build bundler is available", () => {
    expect(typeof Bun.build).toBe("function");
  });

  test("bundle a simple TS entrypoint in-memory", async () => {
    makeDir(FIXTURE_DIR, { recursive: true });
    writeText(join(FIXTURE_DIR, "entry.ts"), "export const x: number = 42;");

    try {
      const result = await Bun.build({
        entrypoints: [join(FIXTURE_DIR, "entry.ts")],
        target: "bun",
        minify: false,
      });
      expect(result.success).toBe(true);
      expect(result.outputs.length).toBeGreaterThan(0);
      expect(result.outputs[0].kind).toBe("entry-point");
    } finally {
      removePath(FIXTURE_DIR, { recursive: true, force: true });
    }
  });

  test("build with CLI produces executable output", async () => {
    makeDir(FIXTURE_DIR, { recursive: true });
    writeText(join(FIXTURE_DIR, "cli.ts"), 'console.log("build ok");');
    const outfile = join(FIXTURE_DIR, "out.js");

    try {
      const result =
        await $`bun build ${FIXTURE_DIR}/cli.ts --outfile=${outfile} --target=bun`.nothrow();
      expect(result.exitCode).toBe(0);
    } finally {
      removePath(FIXTURE_DIR, { recursive: true, force: true });
    }
  });
});
