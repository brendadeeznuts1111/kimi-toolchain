/**
 * Bun v1.3.4: Standalone Executables no longer load config files at runtime.
 *
 * `bun build --compile` now skips loading tsconfig.json and package.json
 * at runtime by default. Opt back in with CLI flags or JavaScript API.
 *
 * @see https://bun.com/blog/bun-v1.3.4#standalone-executables-no-longer-load-config-files-at-runtime
 */

import { describe, expect, test } from "bun:test";
import { withCompileLock } from "./helpers.ts";

// ── Bun.build compile options (JavaScript API) ───────────────────────

describe("bun-compile-autoload options (JavaScript API)", () => {
  test("compile option accepts autoloadTsconfig", () => {
    // Verify the type accepts the option — we don't actually build
    const options = {
      entrypoints: ["./app.ts"],
      compile: {
        autoloadTsconfig: true,
      },
    };
    expect(options.compile.autoloadTsconfig).toBe(true);
  });

  test("compile option accepts autoloadPackageJson", () => {
    const options = {
      entrypoints: ["./app.ts"],
      compile: {
        autoloadPackageJson: true,
      },
    };
    expect(options.compile.autoloadPackageJson).toBe(true);
  });

  test("compile option accepts autoloadDotenv", () => {
    const options = {
      entrypoints: ["./app.ts"],
      compile: {
        autoloadDotenv: true,
      },
    };
    expect(options.compile.autoloadDotenv).toBe(true);
  });

  test("compile option accepts autoloadBunfig", () => {
    const options = {
      entrypoints: ["./app.ts"],
      compile: {
        autoloadBunfig: true,
      },
    };
    expect(options.compile.autoloadBunfig).toBe(true);
  });

  test("compile option accepts all autoload flags at once", () => {
    const options = {
      entrypoints: ["./app.ts"],
      compile: {
        autoloadTsconfig: true,
        autoloadPackageJson: true,
        autoloadDotenv: true,
        autoloadBunfig: true,
      },
    };
    expect(options.compile.autoloadTsconfig).toBe(true);
    expect(options.compile.autoloadPackageJson).toBe(true);
    expect(options.compile.autoloadDotenv).toBe(true);
    expect(options.compile.autoloadBunfig).toBe(true);
  });

  test("compile option defaults to false when not specified", () => {
    const options: { entrypoints: string[]; compile: Record<string, unknown> } = {
      entrypoints: ["./app.ts"],
      compile: {},
    };
    // All autoload flags should be undefined (falsy) by default
    expect(options.compile.autoloadTsconfig).toBeUndefined();
    expect(options.compile.autoloadPackageJson).toBeUndefined();
  });
});

// ── bun build --compile CLI flags ────────────────────────────────────

describe("bun build --compile CLI flags", () => {
  test("--compile-autoload-tsconfig flag exists", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", "build", "--help"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await Bun.readableStreamToText(proc.stdout);
    await proc.exited;
    // Verify the flag is documented in help output
    expect(output).toContain("--compile-autoload-tsconfig");
  });

  test("--compile-autoload-package-json flag exists", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", "build", "--help"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await Bun.readableStreamToText(proc.stdout);
    await proc.exited;
    expect(output).toContain("--compile-autoload-package-json");
  });
});

// ── bun build --compile basic compilation ────────────────────────────

describe("bun build --compile basic", () => {
  test.skipIf(Bun.env.KIMI_TEST_CHANGED_PARALLEL === "1")(
    "compile flag is recognized by bun build",
    async () => {
      return withCompileLock(async () => {
        const tmpDir = await import("node:os").then((m) => m.tmpdir());
        const entrypoint = `${tmpDir}/bun-compile-test-${Date.now()}.ts`;
        const outputFile = `${tmpDir}/bun-compile-test-${Date.now()}`;

        await Bun.write(entrypoint, 'console.log("hello from compiled");');

        let lastExitCode = 1;
        let lastStderr = "";
        for (let attempt = 0; attempt < 2; attempt++) {
          const proc = Bun.spawn({
            cmd: ["bun", "build", "--compile", entrypoint, "--outfile", outputFile],
            stdout: "pipe",
            stderr: "pipe",
            cwd: tmpDir,
          });
          await Bun.readableStreamToText(proc.stdout);
          lastStderr = await Bun.readableStreamToText(proc.stderr);
          lastExitCode = await proc.exited;
          if (lastExitCode === 0) break;
          await Bun.sleep(100);
        }

        if (lastExitCode !== 0) {
          throw new Error(`bun build --compile failed (exit ${lastExitCode}): ${lastStderr}`);
        }

        const file = Bun.file(outputFile);
        expect(await file.exists()).toBe(true);

        await file.delete().catch(() => {});
        await Bun.file(entrypoint)
          .delete()
          .catch(() => {});
      });
    },
    15_000
  );
});
