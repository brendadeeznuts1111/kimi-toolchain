import { describe, expect, test } from "bun:test";
import { join } from "path";
import { REPO_ROOT } from "./helpers.ts";

const CONFIG_STATUS = join(REPO_ROOT, "scripts/config-status.ts");

async function runCli(
  script: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", script, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("config-status CLI", () => {
  test("config:status --json emits schema and exits 0 in clean repo", async () => {
    const { stdout, exitCode } = await runCli(CONFIG_STATUS, ["--json"], REPO_ROOT);
    expect(exitCode).toBe(0);
    const report = JSON.parse(stdout.trim()) as {
      schemaVersion: number;
      tool: string;
      aligned: boolean;
      gates: Array<{ id: string; status: string }>;
    };
    expect(report.schemaVersion).toBe(1);
    expect(report.tool).toBe("config-status");
    expect(report.aligned).toBe(true);
    expect(report.gates).toHaveLength(3);
    for (const gate of report.gates) {
      expect(gate.status).toBe("pass");
    }
  });

  test("config:status --help exits 0 and mentions --with-scaffold", async () => {
    const { stdout, exitCode } = await runCli(CONFIG_STATUS, ["--help"], REPO_ROOT);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--with-scaffold");
    expect(stdout).toContain("config:status");
  });
});
