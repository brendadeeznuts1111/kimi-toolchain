import { describe, test, expect } from "bun:test";
import { $ } from "bun";
import { join } from "path";

const REPO_ROOT = import.meta.dir + "/..";
const BIN_DIR = join(REPO_ROOT, "src", "bin");

async function runTool(name: string, args: string[] = []): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", join(BIN_DIR, `${name}.ts`), ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await Bun.readableStreamToText(proc.stdout);
  const stderr = await Bun.readableStreamToText(proc.stderr);
  return { stdout, stderr, exitCode };
}

describe("kimi-doctor", () => {
  test("runs without crashing", async () => {
    const { exitCode, stdout } = await runTool("kimi-doctor");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Kimi Doctor");
    expect(stdout).toContain("Summary");
  });

  test("detects system health", async () => {
    const { stdout } = await runTool("kimi-doctor");
    expect(stdout).toContain("disk:");
    expect(stdout).toContain("memory:");
    expect(stdout).toContain("load:");
  });

  test("checks all toolchain tools", async () => {
    const { stdout } = await runTool("kimi-doctor");
    expect(stdout).toContain("kimi-guardian:");
    expect(stdout).toContain("kimi-governance:");
    expect(stdout).toContain("kimi-memory:");
  });
});

describe("kimi-fix", () => {
  test("shows help without project path", async () => {
    const { exitCode, stdout } = await runTool("kimi-fix");
    expect(exitCode).toBe(1);
    expect(stdout).toContain("Usage:");
  });

  test("accepts --help flag", async () => {
    const { exitCode, stdout } = await runTool("kimi-fix", ["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
  });

  test("dry-run on temp directory", async () => {
    const tmpDir = `/tmp/kimi-fix-test-${Date.now()}`;
    await $`mkdir -p ${tmpDir}`;
    const { exitCode, stdout } = await runTool("kimi-fix", [tmpDir, "--dry-run"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Dry run");
    await $`rm -rf ${tmpDir}`;
  });
});

describe("kimi-governance", () => {
  test("score command runs", async () => {
    const { exitCode, stdout } = await runTool("kimi-governance", ["score"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Grade:");
    expect(stdout).toContain("Breakdown:");
  });

  test("doctor command runs", async () => {
    const { exitCode, stdout } = await runTool("kimi-governance", ["doctor"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Governance Doctor");
  });
});

describe("kimi-memory", () => {
  test("stats command runs", async () => {
    const { exitCode, stdout } = await runTool("kimi-memory", ["stats"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Memory Stats");
  });

  test("doctor command runs", async () => {
    const { exitCode, stdout } = await runTool("kimi-memory", ["doctor"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Memory Doctor");
  });

  test("trends command runs", async () => {
    const { exitCode, stdout } = await runTool("kimi-memory", ["trends"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Warning Trends");
  });
});

describe("kimi-guardian", () => {
  test("check command runs", async () => {
    const { exitCode, stdout } = await runTool("kimi-guardian", ["check"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Guardian");
  });

  test("doctor command runs", async () => {
    const { exitCode, stdout } = await runTool("kimi-guardian", ["doctor"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Guardian Doctor");
  });
});

describe("kimi-release", () => {
  test("validate command runs", async () => {
    const { exitCode, stdout } = await runTool("kimi-release", ["validate"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Commit Validation");
  });

  test("doctor command runs", async () => {
    const { exitCode, stdout } = await runTool("kimi-release", ["doctor"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Release Doctor");
  });
});

describe("kimi-githooks", () => {
  test("doctor command runs", async () => {
    const { exitCode, stdout } = await runTool("kimi-githooks", ["doctor"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Hook Health Check");
  });
});

describe("kimi-context-gen", () => {
  test("freshness command runs", async () => {
    const { exitCode, stdout } = await runTool("kimi-context-gen", ["freshness"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Freshness");
  });

  test("doctor command runs", async () => {
    const { exitCode, stdout } = await runTool("kimi-context-gen", ["doctor"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Context Doctor");
  });
});

describe("kimi-debug", () => {
  test("last command runs", async () => {
    const { exitCode, stdout } = await runTool("kimi-debug", ["last"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("What Broke");
  });
});

describe("kimi-snapshot", () => {
  test("list command runs", async () => {
    const { exitCode, stdout } = await runTool("kimi-snapshot", ["list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Snapshot");
  });
});

describe("kimi-resource-governor", () => {
  test("status command runs", async () => {
    const { exitCode, stdout } = await runTool("kimi-resource-governor", ["status"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Resource Governor");
  });
});

describe("integration: doctor → fix → doctor pipeline", () => {
  test("full pipeline on temp project", async () => {
    const tmpDir = `/tmp/kimi-integration-${Date.now()}`;
    await $`mkdir -p ${tmpDir}`;

    // Step 1: doctor on empty project
    const doctor1 = await runTool("kimi-doctor");
    expect(doctor1.exitCode).toBe(0);

    // Step 2: fix the temp project
    const fix = await runTool("kimi-fix", [tmpDir, "--dry-run"]);
    expect(fix.exitCode).toBe(0);
    expect(fix.stdout).toContain("Dry run");

    // Step 3: doctor again
    const doctor2 = await runTool("kimi-doctor");
    expect(doctor2.exitCode).toBe(0);

    await $`rm -rf ${tmpDir}`;
  });
});

describe("integration: warning trending across tools", () => {
  test("governance doctor records warnings, memory trends shows them", async () => {
    // Run governance doctor (records warnings)
    const gov = await runTool("kimi-governance", ["doctor"]);
    expect(gov.exitCode).toBe(0);

    // Run memory trends (should show persistent warnings)
    const trends = await runTool("kimi-memory", ["trends"]);
    expect(trends.exitCode).toBe(0);
    expect(trends.stdout).toContain("Warning Trends");
  });
});
