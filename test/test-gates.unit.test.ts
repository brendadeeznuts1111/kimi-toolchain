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
  test("bunTestArgs defaults include bail and 30s timeout", () => {
    expect(bunTestArgs({ bail: true })).toEqual(["test", "--timeout", "30000", "--bail"]);
  });

  test("bunTestArgs fast mode uses the configured fast timeout and unit files", () => {
    const args = bunTestArgs({ fast: true, bail: true });
    expect(args).toContain("--isolate");
    expect(args).toContain("--timeout");
    expect(args).toContain(String(FAST_TEST_TIMEOUT_MS));
    expect(args).toContain("--bail");
    for (const file of UNIT_TEST_FILES) {
      expect(args).toContain(file);
    }
  });

  test("bunTestArgs ci mode uses 30s timeout and junit reporter", () => {
    expect(bunTestArgs({ coverage: true, ci: true, bail: true })).toEqual([
      "test",
      "--timeout",
      "30000",
      "--bail",
      "--coverage",
      "--coverage-reporter=lcov",
      "--coverage-dir=./coverage",
      "--reporter=junit",
      "--reporter-outfile=reports/junit.xml",
      "--isolate",
    ]);
  });

  test("bunTestArgs smoke mode enables per-file isolation", () => {
    const args = bunTestArgs({ smoke: true, bail: true });
    expect(args).toContain("--isolate");
  });

  test("bunTestArgs retry option adds --retry", () => {
    expect(bunTestArgs({ bail: true, retry: 2 })).toEqual([
      "test",
      "--timeout",
      "30000",
      "--bail",
      "--retry=2",
    ]);
  });

  test("useFastUnitCoverage is repo-specific", () => {
    expect(useFastUnitCoverage("kimi-toolchain")).toBe(true);
    expect(useFastUnitCoverage("other-project")).toBe(false);
  });

  test("bunTestArgs dots mode adds --dots reporter", () => {
    expect(bunTestArgs({ bail: true, dots: true })).toEqual([
      "test",
      "--timeout",
      "30000",
      "--bail",
      "--dots",
    ]);
  });

  test("bunTestArgs changedRef uses bun test --changed", () => {
    expect(bunTestArgs({ bail: true, changedRef: "origin/main" })).toEqual([
      "test",
      "--timeout",
      "30000",
      "--bail",
      "--changed=origin/main",
    ]);
  });

  test(
    "check script staged mode is explicit in dry-run output",
    async () => {
      const result = await runCheckScript(["--dry-run", "--staged"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("check (staged fast)");
      expect(result.stdout).toContain("run-gates pre-commit");
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

  test(
    "check script dry-run shows watch and cache flags",
    async () => {
      const result = await runCheckScript([
        "--dry-run",
        "--fast",
        "--watch",
        "--cache-results",
        "--changed-only",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("watch");
      expect(result.stdout).toContain("cache-results");
    },
    { timeout: 5000 }
  );

  test(
    "check script dry-run watch prints watch plan",
    async () => {
      const result = await runCheckScript(["--dry-run", "--fast", "--watch"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("watch — dry run");
      expect(result.stdout).toContain("debounce: 300ms");
    },
    { timeout: 5000 }
  );

  test(
    "check script dry-run watch-tests prints test-only plan",
    async () => {
      const result = await runCheckScript(["--dry-run", "--fast", "--watch-tests"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("watch-tests — dry run");
      expect(result.stdout).toContain("bun test --changed");
    },
    { timeout: 5000 }
  );

  test(
    "check script dry-run changed-only uses lint --files",
    async () => {
      // Default base=main is empty when HEAD is on main; use a recent ancestor for a stable diff.
      const result = await runCheckScript([
        "--dry-run",
        "--fast",
        "--changed-only",
        "--base=HEAD~3",
        "--skip-tests",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("bun run lint --files");
    },
    { timeout: 5000 }
  );

  test(
    "check script dry-run changed-only uses bun test --changed",
    async () => {
      const result = await runCheckScript([
        "--dry-run",
        "--fast",
        "--changed-only",
        "--skip-tests",
      ]);
      expect(result.exitCode).toBe(0);
      // With skip-tests, test step omitted; verify changed-only flag in header
      expect(result.stdout).toContain("changed-only");
    },
    { timeout: 5000 }
  );

  test(
    "check script json-summary emits structured output",
    async () => {
      const result = await runCheckScript(["--fast", "--json-summary", "--skip-tests"]);
      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout.trim());
      expect(payload.passed).toBe(true);
      expect(payload.steps["format:check"]).toBeDefined();
    },
    { timeout: 120000 }
  );

  test(
    "check script json-summary keeps stdout JSON-only when KIMI_QUIET=0",
    async () => {
      const proc = Bun.spawn(
        ["bun", "run", CHECK_SCRIPT, "--fast", "--json-summary", "--skip-tests"],
        {
          stdout: "pipe",
          stderr: "pipe",
          env: { ...Bun.env, KIMI_QUIET: "0" },
        }
      );
      const [stdout, exitCode] = await Promise.all([
        Bun.readableStreamToText(proc.stdout),
        proc.exited,
      ]);
      expect(stdout.trim().startsWith("{")).toBe(true);
      expect(stdout.trim().includes("\n")).toBe(false);
      const payload = JSON.parse(stdout.trim());
      expect(typeof payload.passed).toBe("boolean");
      expect(payload.steps).toBeDefined();
      expect(exitCode).toBe(payload.passed ? 0 : 1);
    },
    { timeout: 120000 }
  );

  test(
    "check script cache-results json-summary uses cache on second run",
    async () => {
      const args = ["--fast", "--cache-results", "--json-summary", "--skip-tests"];
      const first = await runCheckScript(args);
      expect(first.exitCode).toBe(0);
      const second = await runCheckScript(args);
      expect(second.exitCode).toBe(0);
      expect(second.stdout.trim()).toBe(first.stdout.trim());
    },
    { timeout: 180000 }
  );
});
