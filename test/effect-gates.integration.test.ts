import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = import.meta.dir + "/..";
const HEAL = join(REPO_ROOT, "src/bin/kimi-heal.ts");
const DOCTOR = join(REPO_ROOT, "src/bin/kimi-doctor.ts");

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
  if (proc.exitCode === null && exitCode !== 0) {
    // Wait a tick for streams to flush when killed.
    await new Promise((r) => setTimeout(r, 10));
  }
  return { stdout, stderr, exitCode };
}

describe("effect-gates CLI", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await Bun.fileURLToPath(
      new URL(
        `./effect-gates-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        "file:///tmp/"
      )
    );
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await mkdir(join(tmpDir, ".kimi", "var"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("kimi-heal effect audit --json emits effect-gates-report schema and exits 0 when clean", async () => {
    const { stdout, exitCode } = await runCli(
      HEAL,
      ["effect", "audit", "--json", "--project-root", tmpDir],
      REPO_ROOT
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim()) as {
      schemaName: string;
      payload: { tool: string; violations: unknown[]; summary: { total: number } };
    };
    expect(parsed.schemaName).toBe("effect-gates-report");
    expect(parsed.payload.tool).toBe("kimi-heal");
    expect(Array.isArray(parsed.payload.violations)).toBe(true);
    expect(parsed.payload.summary.total).toBe(0);
  });

  test("kimi-heal effect audit --json exits non-zero on violations", async () => {
    await writeFile(
      join(tmpDir, "src", "service.ts"),
      `export function fetchUser() { return fetch("/user").then(r => r.json()); }`
    );

    const { stdout, exitCode } = await runCli(
      HEAL,
      ["effect", "audit", "--json", "--project-root", tmpDir],
      REPO_ROOT
    );
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout.trim()) as {
      payload: { summary: { total: number }; violations: Array<{ gate: string }> };
    };
    expect(parsed.payload.summary.total).toBeGreaterThan(0);
  });

  test("kimi-heal effect audit --event-streams --json detects EventEmitter in src/services", async () => {
    await mkdir(join(tmpDir, "src", "services"), { recursive: true });
    await writeFile(
      join(tmpDir, "src", "services", "broker.ts"),
      `import { EventEmitter } from "events"; export const broker = new EventEmitter();`
    );

    const { stdout, exitCode } = await runCli(
      HEAL,
      ["effect", "audit", "--event-streams", "--json", "--project-root", tmpDir],
      REPO_ROOT
    );
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout.trim()) as {
      payload: { violations: Array<{ gate: string; message: string }> };
    };
    expect(parsed.payload.violations.some((v) => v.gate === "event-stream")).toBe(true);
  });

  test("kimi-doctor --effect-gates --json emits trend report and appends snapshot", async () => {
    const first = await runCli(
      DOCTOR,
      ["--effect-gates", "--json", "--project-root", tmpDir],
      REPO_ROOT
    );
    expect(first.exitCode).toBe(0);
    const firstParsed = JSON.parse(first.stdout.trim()) as {
      effectGates: { previous: unknown; current: { generatedAt: string }; delta: unknown };
      summary: { ok: boolean };
    };
    expect(firstParsed.effectGates.previous).toBeNull();
    expect(firstParsed.effectGates.current.generatedAt).toBeDefined();
    expect(firstParsed.effectGates.delta).toBeDefined();
    expect(firstParsed.summary.ok).toBe(true);

    const second = await runCli(
      DOCTOR,
      ["--effect-gates", "--json", "--project-root", tmpDir],
      REPO_ROOT
    );
    expect(second.exitCode).toBe(0);
    const secondParsed = JSON.parse(second.stdout.trim()) as {
      effectGates: { previous: { generatedAt: string }; current: { generatedAt: string } };
    };
    expect(secondParsed.effectGates.previous).not.toBeNull();
    expect(secondParsed.effectGates.previous.generatedAt).toBe(
      firstParsed.effectGates.current.generatedAt
    );
  });

  test("kimi-doctor accepts both effect-floor flags without deprecation warn", async () => {
    const { stderr, exitCode } = await runCli(
      DOCTOR,
      [
        "--effect-floor",
        "--session-report",
        "--json",
        "--raw-promises-removed",
        "2",
        "--services-migrated",
        "2",
        "--domain-purity-resolved",
        "1",
        "--raw-errors-converted",
        "1",
        "--event-emitters-converted",
        "0",
        "--circular-layers",
        "0",
      ],
      REPO_ROOT
    );
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("[deprecated]");
  });

  test("kimi-doctor --session-report alias warns and runs effect-floor mode", async () => {
    const { stderr, exitCode } = await runCli(
      DOCTOR,
      [
        "--session-report",
        "--json",
        "--raw-promises-removed",
        "2",
        "--services-migrated",
        "2",
        "--domain-purity-resolved",
        "1",
        "--raw-errors-converted",
        "1",
        "--event-emitters-converted",
        "0",
        "--circular-layers",
        "0",
      ],
      REPO_ROOT
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain("[deprecated] --session-report is renamed to --effect-floor");
  });

  test("kimi-doctor --effect-floor --json fails when a required flag is missing", async () => {
    const { stdout, exitCode } = await runCli(
      DOCTOR,
      [
        "--effect-floor",
        "--json",
        "--raw-promises-removed",
        "2",
        "--services-migrated",
        "2",
        "--domain-purity-resolved",
        "1",
        "--raw-errors-converted",
        "1",
        "--event-emitters-converted",
        "0",
      ],
      REPO_ROOT
    );
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout.trim()) as {
      summary: { passed: boolean; missing: string[] };
      error?: string;
    };
    expect(parsed.summary.passed).toBe(false);
    expect(parsed.summary.missing).toContain("circularLayerDependencies");
  });

  test("kimi-doctor --effect-floor --json auto-derives counts after effect-gates snapshots", async () => {
    const seed = await runCli(
      DOCTOR,
      ["--effect-gates", "--json", "--project-root", tmpDir],
      REPO_ROOT
    );
    expect(seed.exitCode).toBe(0);

    const { stdout, exitCode } = await runCli(
      DOCTOR,
      ["--effect-floor", "--json", "--project-root", tmpDir],
      REPO_ROOT
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim()) as {
      source: string;
      summary: { passed: boolean };
      counts: Record<string, number> | null;
      effectGates: { summary: { ok: boolean } };
    };
    expect(parsed.source).toBe("effect-gates-auto");
    expect(parsed.summary.passed).toBe(true);
    expect(parsed.effectGates.summary.ok).toBe(true);
    expect(parsed.counts).toBeNull();
  });

  test("kimi-doctor --effect-floor --json passes when all floors are met", async () => {
    const { stdout, exitCode } = await runCli(
      DOCTOR,
      [
        "--effect-floor",
        "--json",
        "--raw-promises-removed",
        "2",
        "--services-migrated",
        "2",
        "--domain-purity-resolved",
        "1",
        "--raw-errors-converted",
        "1",
        "--event-emitters-converted",
        "0",
        "--circular-layers",
        "0",
      ],
      REPO_ROOT
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim()) as {
      summary: { passed: boolean; missing: string[]; below: string[] };
    };
    expect(parsed.summary.passed).toBe(true);
    expect(parsed.summary.missing).toHaveLength(0);
    expect(parsed.summary.below).toHaveLength(0);
  });
});
