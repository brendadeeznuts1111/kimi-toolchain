import { makeDir, pathExists, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { REPO_ROOT, testTempDir } from "./helpers.ts";
const FIX = join(REPO_ROOT, "src/bin/kimi-fix.ts");
const SYNC = join(REPO_ROOT, "scripts/sync-to-desktop.ts");

let tmpHome: string;
let projectDir: string;

beforeEach(() => {
  tmpHome = testTempDir("kimi-fix-int-");
  projectDir = join(tmpHome, "demo-app");
  makeDir(projectDir, { recursive: true });
  writeText(
    join(projectDir, "package.json"),
    JSON.stringify({ name: "demo-app", version: "0.0.0" }, null, 2) + "\n"
  );
});

afterEach(() => {
  if (pathExists(tmpHome)) removePath(tmpHome, { recursive: true, force: true });
});

async function runFix(): Promise<{ stdout: string; exitCode: number }> {
  const env = { ...Bun.env, HOME: tmpHome };
  const syncProc = Bun.spawn(["bun", "run", SYNC], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  await syncProc.exited;

  const proc = Bun.spawn(["bun", "run", FIX, projectDir], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const exitCode = await proc.exited;
  const stdout =
    (await Bun.readableStreamToText(proc.stdout)) + (await Bun.readableStreamToText(proc.stderr));
  return { stdout, exitCode };
}

describe("kimi-fix integration", () => {
  test("scaffolds files in target project dir using package.json name", async () => {
    const { exitCode } = await runFix();
    expect(exitCode).toBe(0);

    expect(pathExists(join(projectDir, "AGENTS.md"))).toBe(true);
    const agents = await Bun.file(join(projectDir, "AGENTS.md")).text();
    expect(agents).toContain("demo-app");
    expect(pathExists(join(projectDir, "CODE_REFERENCES.md"))).toBe(true);
    const codeReferences = await Bun.file(join(projectDir, "CODE_REFERENCES.md")).text();
    expect(codeReferences).toContain("Local Exemplars");

    expect(pathExists(join(projectDir, "tsconfig.json"))).toBe(true);
    expect(pathExists(join(projectDir, ".kimi-code", "mcp.json"))).toBe(true);
    expect(pathExists(join(projectDir, "scripts", "check.ts"))).toBe(true);
    expect(pathExists(join(projectDir, "README.md"))).toBe(true);
    expect(pathExists(join(REPO_ROOT, "README.md"))).toBe(true);
    expect(pathExists(join(projectDir, "CONTEXT.md"))).toBe(true);
  }, 120_000);
});
