import { describe, expect, test } from "bun:test";
import { join } from "path";

const REPO_ROOT = import.meta.dir + "/..";
const DOCTOR = join(REPO_ROOT, "src/bin/kimi-doctor.ts");
const ORPHAN_KILL = join(REPO_ROOT, "src/bin/kimi-orphan-kill.ts");
const GOVERNOR = join(REPO_ROOT, "src/bin/kimi-resource-governor.ts");
const GOVERNANCE = join(REPO_ROOT, "src/bin/kimi-governance.ts");
const GITHOOKS = join(REPO_ROOT, "src/bin/kimi-githooks.ts");
const GUARDIAN = join(REPO_ROOT, "src/bin/kimi-guardian.ts");

async function runTool(
  path: string,
  args: string[] = []
): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", path, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, HOME: Bun.env.HOME || "/tmp" },
  });
  const exitCode = await proc.exited;
  const stdout = await Bun.readableStreamToText(proc.stdout);
  const stderr = await Bun.readableStreamToText(proc.stderr);
  return { stdout: stdout + stderr, exitCode };
}

describe("kimi-doctor smoke", () => {
  test("doctor --quick includes memory pressure checks", async () => {
    const { stdout, exitCode } = await runTool(DOCTOR, ["--quick"]);
    expect(stdout).toContain("swap-used");
    expect(stdout).toContain("memory-pressure");
    expect(stdout).toContain("load-per-core");
    expect(stdout).toContain("chrome-rss");
    expect(stdout).toContain("docker-desktop");
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 60_000);

  test("doctor --memory-budget prints app groups", async () => {
    const { stdout, exitCode } = await runTool(DOCTOR, ["--memory-budget"]);
    expect(stdout).toContain("Memory Budget");
    expect(stdout).toContain("Tracked subtotal");
    expect(exitCode).toBe(0);
  }, 30_000);

  test("kimi-orphan-kill --dry-run exits cleanly", async () => {
    const { stdout, exitCode } = await runTool(ORPHAN_KILL, ["--dry-run"]);
    expect(stdout).toMatch(/orphan|No orphan/);
    expect(exitCode).toBe(0);
  }, 15_000);

  test("kimi-resource-governor status loads config", async () => {
    const { stdout, exitCode } = await runTool(GOVERNOR, ["status"]);
    expect(stdout).toContain("Config file");
    expect(stdout).toContain("Max parallel");
    expect(exitCode).toBe(0);
  }, 15_000);

  test("kimi-governance score prints grade", async () => {
    if (Bun.env.KIMI_COVERAGE_SCAN) return;
    const { stdout, exitCode } = await runTool(GOVERNANCE, ["score"]);
    expect(stdout).toContain("Grade:");
    expect(stdout).toMatch(/\d+\.\d+%/);
    expect(stdout).toContain("Breakdown:");
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 30_000);

  test("kimi-githooks doctor reports hook health", async () => {
    const { stdout, exitCode } = await runTool(GITHOOKS, ["doctor"]);
    expect(stdout).toContain("Hook Health Check");
    expect(stdout).toContain("pre-commit");
    expect(exitCode).toBe(0);
  }, 15_000);

  test("kimi-guardian check runs supply chain scan", async () => {
    const { stdout, exitCode } = await runTool(GUARDIAN, ["check"]);
    expect(stdout).toContain("Guardian");
    expect(stdout).toContain("Lockfile");
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 30_000);

  test("doctor --json emits structured report", async () => {
    const { stdout, exitCode } = await runTool(DOCTOR, ["--quick", "--json"]);
    const report = JSON.parse(stdout.trim()) as {
      checks: Array<{ name: string; status: string }>;
      sync?: { synced: boolean };
      summary: { errors: number; warnings: number };
    };
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.summary).toBeDefined();
    expect(report.sync).toBeDefined();
    expect(typeof report.sync?.synced).toBe("boolean");
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 60_000);

  test("doctor --quick reports runtime sync section", async () => {
    const { stdout } = await runTool(DOCTOR, ["--quick"]);
    expect(stdout).toContain("Runtime Sync");
    expect(stdout).toMatch(/Desktop sync/);
  }, 60_000);

  test("check script uses check.ts runner", async () => {
    const pkg = (await Bun.file(join(REPO_ROOT, "package.json")).json()) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.check).toBe("bun run scripts/check.ts");
    expect(pkg.scripts?.["check:fast"]).toContain("--fast");
    expect(pkg.scripts?.["check:fast"]).toContain("--timeout 100");
    expect(pkg.scripts?.["check:dry-run"]).toContain("--dry-run");
  });

  test("check --dry-run lists gate steps", async () => {
    const proc = Bun.spawn(["bun", "run", "scripts/check.ts", "--dry-run"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await Bun.readableStreamToText(proc.stdout);
    expect(await proc.exited).toBe(0);
    expect(out).toContain("format:check");
    expect(out).toContain("typecheck");
    expect(out).toContain("bun test");
  }, 5_000);

  test("test:fast completes under 100ms per-test timeout", async () => {
    const proc = Bun.spawn(["bun", "run", "test:fast"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      Bun.readableStreamToText(proc.stdout),
      Bun.readableStreamToText(proc.stderr),
      proc.exited,
    ]);
    expect(code).toBe(0);
    expect(stdout + stderr).toMatch(/\d+ pass/);
  }, 15_000);
});
