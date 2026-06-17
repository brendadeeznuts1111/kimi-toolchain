import { removePath } from "../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { desktopRoot } from "../src/lib/paths.ts";
import { syncDesktop } from "../src/lib/desktop-sync.ts";

import { REPO_ROOT, testTempDir, withEnv } from "./helpers.ts";
const META = join(REPO_ROOT, "src/bin/kimi-toolchain.ts");
const DOCTOR = join(REPO_ROOT, "src/bin/kimi-doctor.ts");

async function run(
  path: string,
  args: string[] = []
): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", path, ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, HOME: Bun.env.HOME || "/tmp" },
  });
  const exitCode = await proc.exited;
  const stdout = await Bun.readableStreamToText(proc.stdout);
  const stderr = await Bun.readableStreamToText(proc.stderr);
  return { stdout: stdout + stderr, exitCode };
}

describe("kimi-toolchain router", () => {
  test("--help lists tools", async () => {
    const { stdout, exitCode } = await run(META, ["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("kimi-toolchain");
    expect(stdout).toContain("doctor");
    expect(stdout).toContain("workspace");
  }, 10_000);

  test("workspace verify runs", async () => {
    const { stdout, exitCode } = await run(META, ["workspace", "verify"]);
    expect(stdout).toContain("Workspace verify");
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 15_000);

  test("doctor subcommand delegates", async () => {
    const { stdout, exitCode } = await run(META, ["doctor", "--workspace", "--json"]);
    const parsed = JSON.parse(stdout.trim()) as { checks?: unknown[] };
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 30_000);

  test("kimi-doctor workspace verify matches router", async () => {
    const a = await run(DOCTOR, ["workspace", "verify"]);
    const b = await run(META, ["workspace", "verify"]);
    expect(a.stdout).toContain("Workspace verify");
    expect(b.stdout).toContain("Workspace verify");
  }, 15_000);

  test("synced meta workspace verify resolves caller project root", async () => {
    const tmpHome = testTempDir("router-home-");
    await withEnv({ HOME: tmpHome }, async () => {
      await syncDesktop(REPO_ROOT, { force: true });
      const script = join(desktopRoot(), "tools", "kimi-toolchain.ts");
      const proc = Bun.spawn(["bun", script, "workspace", "verify"], {
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...Bun.env, HOME: tmpHome },
      });
      const exitCode = await proc.exited;
      const stdout = await Bun.readableStreamToText(proc.stdout);
      const stderr = await Bun.readableStreamToText(proc.stderr);
      expect(stdout + stderr).toContain(`Path: ${REPO_ROOT}`);
      expect(exitCode === 0 || exitCode === 1).toBe(true);
    });
    removePath(tmpHome, { recursive: true, force: true });
  }, 15_000);
});
