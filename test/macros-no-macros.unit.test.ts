import { describe, expect, test } from "bun:test";

// ── --no-macros Flag Tests ───────────────────────────────────────────
//
// In Bun 1.3.14, --no-macros does not produce build errors for modules
// that import from "bun" with { type: "macro" }. The macros still execute
// at build time. These tests document the actual behavior:
//   1. The --no-macros flag is accepted (no crash)
//   2. Build output is still produced
//   3. The macro values are still inlined (macros execute regardless)
//
// If Bun changes this behavior in a future version to disable macros,
// these tests should be updated to verify build failure instead.

describe("macros > --no-macros flag", () => {
  const macroModules = [
    "src/lib/theme.ts",
    "src/lib/build-info.ts",
    "src/lib/cli-help.ts",
    "src/lib/embedded-assets.ts",
    "src/lib/dependency-versions.ts",
    "src/lib/embedded-docs.ts",
  ];

  for (const module of macroModules) {
    test(`--no-macros flag is accepted for ${module}`, () => {
      const { exitCode, stderr } = Bun.spawnSync({
        cmd: ["bun", "build", module, "--no-macros", "--outdir", "/tmp/macro-test-out"],
        stdout: "pipe",
        stderr: "pipe",
      });

      // Build should succeed (flag is accepted, macros still execute in 1.3.14)
      expect(exitCode).toBe(0);
      // No crash or fatal error
      const errOutput = stderr.toString().toLowerCase();
      expect(errOutput).not.toContain("fatal");
      expect(errOutput).not.toContain("panic");
    });
  }

  test("--no-macros still inlines macro values in output", () => {
    const { exitCode } = Bun.spawnSync({
      cmd: ["bun", "build", "src/lib/theme.ts", "--no-macros", "--outdir", "/tmp/macro-test-out"],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);

    // Read the output file and verify macro values are inlined
    const { stdout } = Bun.spawnSync({
      cmd: ["cat", "/tmp/macro-test-out/theme.js"],
      stdout: "pipe",
    });
    const output = stdout.toString();
    // color() macro should have been resolved to static strings
    expect(output).toContain("red");
    expect(output).not.toContain("color(");
  });
});
