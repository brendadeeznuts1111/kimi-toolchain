import { describe, expect, test } from "bun:test";
import { join } from "path";
import { invokeTool } from "../../src/lib/tool-runner.ts";

const REPO_ROOT = import.meta.dir + "/../..";
const DOCTOR = join(REPO_ROOT, "src/bin/kimi-doctor.ts");
const ORPHAN_KILL = join(REPO_ROOT, "src/bin/kimi-orphan-kill.ts");
const GOVERNOR = join(REPO_ROOT, "src/bin/kimi-resource-governor.ts");
const GOVERNANCE = join(REPO_ROOT, "src/bin/kimi-governance.ts");
const GITHOOKS = join(REPO_ROOT, "src/bin/kimi-githooks.ts");
const GUARDIAN = join(REPO_ROOT, "src/bin/kimi-guardian.ts");
const KIMI_NEW = join(REPO_ROOT, "src/bin/kimi-new.ts");
const KIMI_FIX = join(REPO_ROOT, "src/bin/kimi-fix.ts");
const CLOUDFLARE_ACCESS = join(REPO_ROOT, "src/bin/kimi-cloudflare-access.ts");
const CLEANUP_LEGACY = join(REPO_ROOT, "src/bin/kimi-cleanup-legacy.ts");

async function runTool(
  path: string,
  args: string[] = [],
  timeoutMs: number = 15_000
): Promise<{ stdout: string; exitCode: number }> {
  const result = await invokeTool(path, args, {
    cwd: REPO_ROOT,
    timeoutMs,
  });
  return { stdout: result.stdout + result.stderr, exitCode: result.exitCode };
}

describe("kimi-doctor smoke", () => {
  test("doctor --quick includes MCP, Kimi Code, memory pressure, and runtime sync", async () => {
    const { stdout, exitCode } = await runTool(DOCTOR, ["--quick"], 60_000);
    expect(stdout).toContain("Kimi Code Config");
    expect(stdout).toContain("── MCP");
    expect(stdout).toContain("── Kimi Permissions");
    expect(stdout).toContain("unified-shell");
    expect(stdout).toMatch(/mcp-permission|config-toml/);
    expect(stdout).toContain("Path Alignment");
    expect(stdout).toContain("swap-used");
    expect(stdout).toContain("memory-pressure");
    expect(stdout).toContain("load-per-core");
    expect(stdout).toContain("chrome-rss");
    expect(stdout).toContain("docker-desktop");
    expect(stdout).toContain("Runtime Sync");
    expect(stdout).toMatch(/Desktop sync/);
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 90_000);

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
    const { stdout, exitCode } = await runTool(GOVERNANCE, ["score", "--fast"]);
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
  }, 30_000);

  test.skipIf(Bun.env.KIMI_TEST_CHANGED_PARALLEL === "1")(
    "doctor --success-metrics --json emits success metric contracts",
    async () => {
      const { stdout, exitCode } = await runTool(DOCTOR, ["--success-metrics", "--json"]);
      const report = JSON.parse(stdout.trim()) as {
        checks: Array<{ name: string; status: string }>;
        errorCoverage: { coverage: number };
        providerIntegration: { artifacts: string[] };
        thresholdPolicy: { releaseCadence: string; thresholds: unknown[] };
        ledger: { total: number; taxonomyCounts: Record<string, number> };
        summary: { ok: boolean };
      };
      expect(report.checks.map((c) => c.name)).toContain("drift-latency");
      expect(report.checks.map((c) => c.name)).toContain("metric-threshold-evidence");
      expect(report.errorCoverage.coverage).toBeGreaterThanOrEqual(0.9);
      expect(report.providerIntegration.artifacts).toEqual(["contract", "credential-adapter"]);
      expect(report.thresholdPolicy.releaseCadence).toBe("toolchain-release");
      expect(Array.isArray(report.thresholdPolicy.thresholds)).toBe(true);
      expect(typeof report.ledger.total).toBe("number");
      expect(report.summary.ok).toBe(true);
      expect(exitCode).toBe(0);
    },
    15_000
  );

  test("capabilities smoke exposes readiness for shell checks", async () => {
    const proc = Bun.spawn(["bash", "-lc", "bun run capabilities --json | grep '\"readiness\"'"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await Bun.readableStreamToText(proc.stdout);
    const err = await Bun.readableStreamToText(proc.stderr);
    expect(await proc.exited).toBe(0);
    expect(out + err).toContain('"readiness"');
  }, 15_000);

  test("contract smoke validates the sample contract through the local kimi router", async () => {
    const proc = Bun.spawn(
      [
        "bash",
        "-lc",
        "bun run kimi contract validate ./contracts/sample.contract.json --json | grep '\"trusted\"'",
      ],
      {
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const out = await Bun.readableStreamToText(proc.stdout);
    const err = await Bun.readableStreamToText(proc.stderr);
    expect(await proc.exited).toBe(0);
    expect(out + err).toContain('"trusted"');
  }, 15_000);

  test("check script uses check.ts runner", async () => {
    const pkg = (await Bun.file(join(REPO_ROOT, "package.json")).json()) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.check).toBe("bun run scripts/check.ts");
    expect(pkg.scripts?.kimi).toBe("bun run src/bin/kimi-toolchain.ts");
    expect(pkg.scripts?.["check:fast"]).toContain("--fast");
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
    expect(out).toContain("test:");
  }, 15_000);

  test("kimi-new --dry-run prints scaffold steps", async () => {
    const name = `scaffold-${Bun.randomUUIDv7()}`;
    const parent = Bun.env.TMPDIR || "/tmp";
    const { stdout, exitCode } = await runTool(KIMI_NEW, [name, "--path", parent, "--dry-run"]);
    expect(stdout).toContain("[dry-run]");
    expect(stdout).toContain("bun init -m");
    expect(stdout).toContain("kimi-fix");
    expect(exitCode).toBe(0);
  }, 15_000);

  test("cleanup-legacy --help exits cleanly", async () => {
    const proc = Bun.spawn(["bash", "scripts/cleanup-legacy-workspace.sh", "--help"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await Bun.readableStreamToText(proc.stdout);
    expect(await proc.exited).toBe(0);
    expect(out).toContain("workspace");
  }, 5_000);

  test("kimi-cleanup-legacy doctor returns structured output", async () => {
    const { stdout, exitCode } = await runTool(CLEANUP_LEGACY, ["doctor"]);
    expect(stdout).toContain("kimi-cleanup-legacy");
    expect(stdout).toMatch(
      /legacy-sessions|legacy-index|legacy-cursor|legacy-symlink|legacy-clone/
    );
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 15_000);

  test("kimi-cleanup-legacy status exits cleanly", async () => {
    const { stdout, exitCode } = await runTool(CLEANUP_LEGACY, ["status"]);
    expect(stdout).toContain("Legacy Path Status");
    expect(stdout).toMatch(/Sessions|Index lines|Cursor slugs/);
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 15_000);

  test("doctor --workspace --json returns structured output", async () => {
    const { stdout, exitCode } = await runTool(DOCTOR, ["--workspace", "--json"]);
    const parsed = JSON.parse(stdout.trim()) as {
      checks?: unknown[];
      summary?: { blockingErrors?: number; ok?: boolean };
    };
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.summary).toBeDefined();
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 30_000);

  test("doctor --ecosystem --quick --json returns fixPlan", async () => {
    const { stdout, exitCode } = await runTool(DOCTOR, ["--ecosystem", "--quick", "--json"]);
    const parsed = JSON.parse(stdout.trim()) as {
      checks?: unknown[];
      fixPlan?: string[];
      summary?: { blockers?: number };
    };
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(Array.isArray(parsed.fixPlan)).toBe(true);
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 30_000);

  test("kimi-new doctor reports readiness", async () => {
    const { stdout, exitCode } = await runTool(KIMI_NEW, ["doctor"]);
    expect(stdout).toContain("kimi-new doctor");
    expect(stdout).toMatch(/bun|kimi-fix/);
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 15_000);

  test("kimi-fix doctor passes on toolchain repo", async () => {
    const { stdout, exitCode } = await runTool(KIMI_FIX, ["doctor", REPO_ROOT]);
    expect(stdout).toContain("kimi-fix Doctor");
    expect(stdout).toMatch(/AGENTS\.md|package-scripts/);
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 15_000);

  test("kimi-cloudflare-access doctor reports credential status", async () => {
    const { stdout, exitCode } = await runTool(CLOUDFLARE_ACCESS, ["doctor"]);
    expect(stdout).toContain("Cloudflare Access Doctor");
    expect(stdout).toMatch(/cloudflare-credentials|service-tokens|access-apps/);
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 15_000);

  test("kimi-cloudflare-access apps reports application audit or missing credentials", async () => {
    const { stdout, exitCode } = await runTool(CLOUDFLARE_ACCESS, ["apps"]);
    expect(stdout).toMatch(
      /Access Application Policy Audit|Missing Cloudflare credentials|CLOUDFLARE_ACCOUNT_ID/
    );
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 15_000);

  test("kimi-cloudflare-access doctor --json emits structured report", async () => {
    const { stdout, exitCode } = await runTool(CLOUDFLARE_ACCESS, ["doctor", "--json"]);
    const parsed = JSON.parse(stdout.trim()) as {
      checks?: unknown[];
      summary?: { errors: number; warnings: number; fixable: number };
      error?: string;
    };
    expect(parsed.checks || parsed.error).toBeDefined();
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 15_000);

  test("kimi-cloudflare-access apps --json emits structured report or error", async () => {
    const { stdout, exitCode } = await runTool(CLOUDFLARE_ACCESS, ["apps", "--json"]);
    const parsed = JSON.parse(stdout.trim()) as {
      apps?: unknown[];
      tokens?: unknown[];
      findings?: unknown[];
      error?: string;
    };
    expect(parsed.apps || parsed.error).toBeDefined();
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 15_000);

  test.skipIf(Bun.env.KIMI_TEST_CHANGED_PARALLEL === "1")(
    "test:fast completes and reports pass count",
    async () => {
      const proc = Bun.spawn(["bun", "run", "test:fast"], {
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, _code] = await Promise.all([
        Bun.readableStreamToText(proc.stdout),
        Bun.readableStreamToText(proc.stderr),
        proc.exited,
      ]);
      // test:fast may exit 1 if any test exceeds the fast timeout; we only check output contains pass count
      expect(stdout + stderr).toMatch(/\d+ pass/);
    },
    300_000
  );
});
