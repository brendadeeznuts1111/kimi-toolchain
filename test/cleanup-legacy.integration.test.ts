import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { makeDir, pathExists, removePath, writeText } from "./helpers.ts";

const REPO_ROOT = import.meta.dir + "/..";
const DOCTOR = join(REPO_ROOT, "src/bin/kimi-doctor.ts");
let tmpHome: string;

beforeEach(() => {
  tmpHome = join(tmpdir(), `cleanup-legacy-${Bun.randomUUIDv7()}`);
  makeDir(tmpHome, { recursive: true });
});

afterEach(() => {
  if (pathExists(tmpHome)) removePath(tmpHome, { recursive: true, force: true });
});

async function runCli(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", DOCTOR, "workspace", ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, HOME: tmpHome, KIMI_PROJECT_ROOT: REPO_ROOT },
  });
  const exitCode = await proc.exited;
  const stdout = await Bun.readableStreamToText(proc.stdout);
  const stderr = await Bun.readableStreamToText(proc.stderr);
  return { stdout: stdout + stderr, exitCode };
}

describe("cleanup-legacy integration", () => {
  test("cleanup audit lists legacy slug without deleting", async () => {
    const slug = join(tmpHome, ".cursor", "projects", "Users-test-kimicode-cli");
    makeDir(slug, { recursive: true });
    writeText(join(slug, "x.json"), "{}");

    const { stdout, exitCode } = await runCli(["cleanup"]);
    expect(stdout).toContain("kimicode-cli");
    expect(pathExists(slug)).toBe(true);
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 15_000);

  test("cleanup --remove-cursor-slugs deletes legacy slug", async () => {
    const slug = join(tmpHome, ".cursor", "projects", "Users-test-kimicode-cli");
    makeDir(slug, { recursive: true });

    const { stdout, exitCode } = await runCli(["cleanup", "--remove-cursor-slugs"]);
    expect(stdout).toContain("Removed");
    expect(pathExists(slug)).toBe(false);
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 15_000);

  test("verify exits non-zero when legacy slug blocks toolchain", async () => {
    const canonical = join(tmpHome, "kimi-toolchain");
    makeDir(canonical, { recursive: true });
    writeText(join(canonical, "package.json"), JSON.stringify({ name: "kimi-toolchain" }));

    const slug = join(tmpHome, ".cursor", "projects", "Users-test-kimicode-cli");
    makeDir(slug, { recursive: true });

    const { exitCode } = await runCli(["verify"]);
    expect(exitCode).toBe(1);
  }, 15_000);
});
