import { describe, expect, test } from "bun:test";
import {
  bunTestArgs,
  FAST_TEST_TIMEOUT_MS,
  UNIT_TEST_FILES,
  useFastUnitCoverage,
} from "../src/lib/test-gates.ts";

const CHECK_SCRIPT = new URL("../scripts/check.ts", import.meta.url).pathname;

async function runCheckScript(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(["bun", "run", CHECK_SCRIPT, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe("test-gates", () => {
  test("bunTestArgs defaults include bail and 5s timeout", () => {
    expect(bunTestArgs({ bail: true })).toEqual(["test", "--timeout", "5000", "--bail"]);
  });

  test("bunTestArgs fast mode uses the configured fast timeout and unit files", () => {
    const args = bunTestArgs({ fast: true, bail: true });
    expect(args).toContain("--timeout");
    expect(args).toContain(String(FAST_TEST_TIMEOUT_MS));
    expect(args).toContain("--bail");
    for (const file of UNIT_TEST_FILES) {
      expect(args).toContain(file);
    }
  });

  test("bunTestArgs ci mode uses 60s timeout and junit reporter", () => {
    expect(bunTestArgs({ coverage: true, ci: true, bail: true })).toEqual([
      "test",
      "--timeout",
      "60000",
      "--bail",
      "--coverage",
      "--reporter=junit",
      "--reporter-outfile=reports/junit.xml",
    ]);
  });

  test("useFastUnitCoverage is repo-specific", () => {
    expect(useFastUnitCoverage("kimi-toolchain")).toBe(true);
    expect(useFastUnitCoverage("other-project")).toBe(false);
  });

  test(
    "check script staged mode is explicit in dry-run output",
    async () => {
      const result = await runCheckScript(["--dry-run", "--staged"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("check (staged fast)");
      expect(result.stdout).toContain("src/bin/kimi-githooks.ts pre-commit");
      expect(result.stdout).toContain("test/unified-shell-bridge.unit.test.ts");
    },
    { timeout: 5000 }
  );

  test(
    "check script rejects unknown options",
    async () => {
      const result = await runCheckScript(["--dry-run", "--unknown"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown option: --unknown");
    },
    { timeout: 5000 }
  );

  test(
    "check script rejects invalid timeout values",
    async () => {
      const result = await runCheckScript(["--dry-run", "--timeout", "nope"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid --timeout: nope");
    },
    { timeout: 5000 }
  );
});
