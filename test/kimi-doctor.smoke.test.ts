import { describe, expect, test } from "bun:test";
import { join } from "path";

const REPO_ROOT = import.meta.dir + "/..";
const DOCTOR = join(REPO_ROOT, "src/bin/kimi-doctor.ts");
const ORPHAN_KILL = join(REPO_ROOT, "src/bin/kimi-orphan-kill.ts");
const GOVERNOR = join(REPO_ROOT, "src/bin/kimi-resource-governor.ts");

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

  test("format:check passes", async () => {
    const proc = Bun.spawn(["bun", "run", "format:check"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await proc.exited).toBe(0);
  }, 30_000);

  test("lint passes", async () => {
    const proc = Bun.spawn(["bun", "run", "lint"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await proc.exited).toBe(0);
  }, 30_000);

  test("typecheck passes", async () => {
    const proc = Bun.spawn(["bun", "run", "typecheck"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await proc.exited).toBe(0);
  }, 30_000);

  test("check script chains format, lint, typecheck, and test", async () => {
    const pkg = (await Bun.file(join(REPO_ROOT, "package.json")).json()) as {
      scripts?: Record<string, string>;
    };
    const check = pkg.scripts?.check ?? "";
    expect(check).toContain("format:check");
    expect(check).toContain("lint");
    expect(check).toContain("typecheck");
    expect(check).toContain("bun test");
  });
});
