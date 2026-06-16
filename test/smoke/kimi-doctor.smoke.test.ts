import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { invokeTool } from "../../src/lib/tool-runner.ts";

const REPO_ROOT = import.meta.dir + "/../..";
const DOCTOR = join(REPO_ROOT, "src/bin/kimi-doctor.ts");
const ORPHAN_KILL = join(REPO_ROOT, "src/bin/kimi-orphan-kill.ts");
const GOVERNOR = join(REPO_ROOT, "src/bin/kimi-resource-governor.ts");
const GOVERNANCE = join(REPO_ROOT, "src/bin/kimi-governance.ts");
const GITHOOKS = join(REPO_ROOT, "src/bin/kimi-githooks.ts");
const GUARDIAN = join(REPO_ROOT, "src/bin/kimi-guardian.ts");
const DEBUG = join(REPO_ROOT, "src/bin/kimi-debug.ts");
const KIMI_NEW = join(REPO_ROOT, "src/bin/kimi-new.ts");
const KIMI_FIX = join(REPO_ROOT, "src/bin/kimi-fix.ts");
const CLOUDFLARE_ACCESS = join(REPO_ROOT, "src/bin/kimi-cloudflare-access.ts");
const CLEANUP_LEGACY = join(REPO_ROOT, "src/bin/kimi-cleanup-legacy.ts");

async function runTool(
  path: string,
  args: string[] = [],
  options: number | { timeoutMs?: number; maxOutputBytes?: number } = 15_000
): Promise<{ stdout: string; exitCode: number }> {
  const { timeoutMs = 15_000, maxOutputBytes } =
    typeof options === "number" ? { timeoutMs: options } : options;

  // For large expected outputs, redirect stdout to a temp file to work around
  // Bun pipe stream data loss on high-volume subprocess output.
  if (maxOutputBytes !== undefined && maxOutputBytes > 1_048_576) {
    const tmpDir = mkdtempSync(join(REPO_ROOT, "node_modules", ".smoke-"));
    const tmpOut = join(tmpDir, "stdout.json");
    try {
      const proc = Bun.spawn(["bun", "run", path, ...args], {
        cwd: REPO_ROOT,
        stdout: Bun.file(tmpOut),
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      const stderr = await Bun.readableStreamToText(proc.stderr);
      const stdout = await Bun.file(tmpOut).text();
      return { stdout: stdout + stderr, exitCode };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  const result = await invokeTool(path, args, {
    cwd: REPO_ROOT,
    timeoutMs,
    ...(maxOutputBytes !== undefined ? { maxOutputBytes } : {}),
  });
  return { stdout: result.stdout + result.stderr, exitCode: result.exitCode };
}

describe("kimi-doctor smoke", () => {
  test("doctor --quick includes MCP, Kimi Code, memory pressure, and runtime sync", async () => {
    const { stdout, exitCode } = await runTool(DOCTOR, ["--quick"]);
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
  }, 15_000);

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
    const { stdout, exitCode } = await runTool(GOVERNANCE, ["score"], 30_000);
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
      checks: Array<{
        name: string;
        status: string;
        optimizerRecommendations?: unknown[];
      }>;
      optimizerChecks?: unknown[];
      sync?: { synced: boolean };
      summary: { errors: number; warnings: number };
    };
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.checks.map((check) => check.name)).toContain("Optimizer");
    const optimizerCheck = report.checks.find((check) => check.name === "Optimizer");
    expect(Array.isArray(optimizerCheck?.optimizerRecommendations)).toBe(true);
    expect(report.optimizerChecks).toBeUndefined();
    expect(report.summary).toBeDefined();
    expect(report.sync).toBeDefined();
    expect(typeof report.sync?.synced).toBe("boolean");
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 15_000);

  test("doctor --success-metrics --json emits success metric contracts", async () => {
    const { stdout, exitCode } = await runTool(DOCTOR, ["--success-metrics", "--json"]);
    const report = JSON.parse(stdout.trim()) as {
      checks: Array<{ name: string; status: string }>;
      errorCoverage: { coverage: number };
      providerIntegration: { artifacts: string[] };
      thresholdPolicy: { releaseCadence: string; thresholds: unknown[] };
      ledger: {
        total: number;
        taxonomyCounts: Record<string, number>;
        reviewCommand: string;
        unknownBuckets: unknown[];
      };
      summary: { ok: boolean };
    };
    expect(report.checks.map((c) => c.name)).toContain("drift-latency");
    expect(report.checks.map((c) => c.name)).toContain("metric-threshold-evidence");
    expect(report.checks.map((c) => c.name)).toContain("failure-ledger-unknowns");
    expect(report.errorCoverage.coverage).toBeGreaterThanOrEqual(0.9);
    expect(report.providerIntegration.artifacts).toEqual(["contract", "credential-adapter"]);
    expect(report.thresholdPolicy.releaseCadence).toBe("toolchain-release");
    expect(Array.isArray(report.thresholdPolicy.thresholds)).toBe(true);
    expect(typeof report.ledger.total).toBe("number");
    expect(report.ledger.reviewCommand).toContain("kimi-debug ledger");
    expect(Array.isArray(report.ledger.unknownBuckets)).toBe(true);
    expect(report.summary.ok).toBe(true);
    expect(exitCode).toBe(0);
  }, 15_000);

  test("doctor --agent --json emits AgentDiagnosisReport", async () => {
    const { stdout, exitCode } = await runTool(DOCTOR, ["--agent", "--json"]);
    const report = JSON.parse(stdout.trim()) as {
      schemaVersion: number;
      tool: string;
      generatedAt: string;
      projectRoot: string;
      summary: { overallConfidence: number; issueCount: number; fixableIssueCount: number };
      confidenceBreakdown: {
        errorCoverage: number;
        ledgerClassification: number;
        healthCheckPassRate: number;
        tuningSetAlignment: number;
      };
      prioritizedIssues: Array<{ name: string; status: string; message: string; priority: number }>;
      proposedActions: Array<{ id: string; title: string; expectedImpact: string }>;
      sourceData: {
        errorCoverage: { coverage: number };
        ledger: { total: number };
        tuningSet: { aligned: boolean };
      };
    };
    expect(report.schemaVersion).toBe(1);
    expect(report.tool).toBe("kimi-doctor");
    expect(typeof report.generatedAt).toBe("string");
    expect(report.projectRoot).toMatch(/kimi-toolchain$/);
    expect(typeof report.summary.overallConfidence).toBe("number");
    expect(typeof report.summary.issueCount).toBe("number");
    expect(typeof report.summary.fixableIssueCount).toBe("number");
    expect(report.confidenceBreakdown.errorCoverage).toBeGreaterThanOrEqual(0);
    expect(report.confidenceBreakdown.ledgerClassification).toBeGreaterThanOrEqual(0);
    expect(report.confidenceBreakdown.healthCheckPassRate).toBeGreaterThanOrEqual(0);
    expect(report.confidenceBreakdown.tuningSetAlignment).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.prioritizedIssues)).toBe(true);
    expect(Array.isArray(report.proposedActions)).toBe(true);
    expect(report.sourceData.errorCoverage.coverage).toBeGreaterThanOrEqual(0.9);
    expect(typeof report.sourceData.ledger.total).toBe("number");
    expect(typeof report.sourceData.tuningSet.aligned).toBe("boolean");
    expect(exitCode).toBe(0);
  }, 15_000);

  test("kimi-debug ledger --json emits sanitized unknown buckets", async () => {
    const dir = join(REPO_ROOT, `.tmp-debug-ledger-${Date.now()}`);
    const ledgerPath = join(dir, "tool-failures.jsonl");
    mkdirSync(dir, { recursive: true });
    await Bun.write(
      ledgerPath,
      [
        JSON.stringify({
          taxonomyId: "unknown",
          toolName: "Edit",
          output: "raw failure text that should not leak",
          timestamp: "2026-06-15T01:00:00.000Z",
        }),
        "not-json",
      ].join("\n")
    );

    const { stdout, exitCode } = await runTool(DEBUG, ["ledger", ledgerPath, "--json"]);
    const report = JSON.parse(stdout.trim()) as {
      schemaVersion: number;
      tool: string;
      summary: {
        total: number;
        unclassified: number;
        unknownBuckets: Array<{ fingerprint: string; count: number; toolNames: string[] }>;
      };
    };
    expect(report.schemaVersion).toBe(1);
    expect(report.tool).toBe("kimi-debug");
    expect(report.summary.total).toBe(2);
    expect(report.summary.unclassified).toBe(2);
    expect(report.summary.unknownBuckets).toHaveLength(2);
    expect(JSON.stringify(report)).not.toContain("raw failure text");
    expect(exitCode).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  }, 15_000);

  test("check script uses check.ts runner", async () => {
    const pkg = (await Bun.file(join(REPO_ROOT, "package.json")).json()) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.check).toBe("bun run scripts/check.ts");
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
    expect(out).toContain("bun test");
  }, 5_000);

  test("kimi-new --dry-run prints scaffold steps", async () => {
    const name = `scaffold-${Bun.randomUUIDv7()}`;
    const parent = Bun.env.TMPDIR || "/tmp";
    const { stdout, exitCode } = await runTool(KIMI_NEW, [name, "--path", parent, "--dry-run"]);
    expect(stdout).toContain("[dry-run]");
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
    expect(exitCode).toBe(0);
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
      optimizerChecks?: unknown[];
      optimizerRecommendations?: unknown[];
      ecosystem?: { blockers?: number };
      fixPlan?: string[];
      summary?: { blockers?: number };
    };
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(Array.isArray(parsed.optimizerChecks)).toBe(true);
    expect(Array.isArray(parsed.optimizerRecommendations)).toBe(true);
    expect(parsed.ecosystem).toBeDefined();
    expect(Array.isArray(parsed.fixPlan)).toBe(true);
    expect(exitCode === 0 || exitCode === 1).toBe(true);
  }, 30_000);

  test("doctor predictive analytics flags emit stable JSON", async () => {
    for (const args of [
      ["--history", "7d", "--json"],
      ["--anomaly", "--json"],
      ["--velocity", "--json"],
      ["--predict", "--json"],
      ["--correlate", "--json"],
    ]) {
      const { stdout, exitCode } = await runTool(DOCTOR, args, {
        maxOutputBytes: 5_000_000,
      });
      const parsed = JSON.parse(stdout.trim()) as {
        schemaVersion?: number;
        tool?: string;
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.tool).toBe("kimi-doctor");
      expect(exitCode === 0 || exitCode === 1).toBe(true);
    }
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

  test("test:fast completes and reports pass count", async () => {
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
    // test:fast may exit 1 if any test exceeds 100ms timeout; we only check output contains pass count
    expect(stdout + stderr).toMatch(/\d+ pass/);
  }, 30_000);

  test("doctor --probe emits a capability manifest", async () => {
    const { stdout, exitCode } = await runTool(DOCTOR, ["--probe"]);
    const manifest = JSON.parse(stdout.trim()) as {
      schemaVersion: number;
      tool: string;
      version: string;
      modes: Array<{ name: string }>;
      flags: Array<{ name: string }>;
      checks: Array<{ type: string; name: string }>;
      supportsMcp: boolean;
      supportsPlugins: boolean;
    };
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.tool).toBe("kimi-doctor");
    expect(typeof manifest.version).toBe("string");
    expect(manifest.modes.map((m) => m.name)).toContain("probe");
    expect(manifest.modes.map((m) => m.name)).toContain("mcp-server");
    expect(manifest.flags.map((f) => f.name)).toContain("--adapter");
    expect(manifest.flags.map((f) => f.name)).toContain("--plugin");
    expect(manifest.checks.map((c) => c.name)).toContain("effect-gates");
    expect(manifest.checks.some((c) => c.type === "adapter")).toBe(true);
    expect(manifest.supportsMcp).toBe(true);
    expect(manifest.supportsPlugins).toBe(true);
    expect(exitCode).toBe(0);
  }, 5_000);

  test("doctor --mcp-server responds to JSON-RPC initialize, tools/list, and tools/call", async () => {
    const proc = Bun.spawn(["bun", "run", DOCTOR, "--mcp-server"], {
      cwd: REPO_ROOT,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const requestId = Date.now();
    const initReq = JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    });

    const stdin = proc.stdin;
    stdin.write(new TextEncoder().encode(`${initReq}\n`));

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let initReceived = false;
    let toolsListReceived = false;
    let probeCallReceived = false;

    async function readLine(): Promise<string | null> {
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) return line;
          continue;
        }
        const { done, value } = await reader.read();
        if (done) return buffer.trim() || null;
        buffer += decoder.decode(value, { stream: true });
      }
    }

    try {
      // Read initialize response
      const initLine = await readLine();
      expect(initLine).not.toBeNull();
      const initRes = JSON.parse(initLine!);
      expect(initRes.jsonrpc).toBe("2.0");
      expect(initRes.id).toBe(requestId);
      expect(initRes.result.serverInfo.name).toBe("kimi-doctor");
      expect(initRes.result.capabilities.tools).toBeDefined();
      initReceived = true;

      // Send tools/list
      const listReq = JSON.stringify({ jsonrpc: "2.0", id: requestId + 1, method: "tools/list" });
      stdin.write(new TextEncoder().encode(`${listReq}\n`));
      const listLine = await readLine();
      expect(listLine).not.toBeNull();
      const listRes = JSON.parse(listLine!);
      expect(listRes.jsonrpc).toBe("2.0");
      const toolNames = listRes.result.tools.map((t: { name: string }) => t.name);
      expect(toolNames).toContain("kimi_doctor_probe");
      expect(toolNames).toContain("kimi_doctor_run");
      expect(toolNames).toContain("kimi_doctor_fix");
      expect(toolNames).toContain("kimi_doctor_run_all");
      toolsListReceived = true;

      // Send tools/call for probe
      const probeReq = JSON.stringify({
        jsonrpc: "2.0",
        id: requestId + 2,
        method: "tools/call",
        params: { name: "kimi_doctor_probe", arguments: {} },
      });
      stdin.write(new TextEncoder().encode(`${probeReq}\n`));
      const probeLine = await readLine();
      expect(probeLine).not.toBeNull();
      const probeRes = JSON.parse(probeLine!);
      expect(probeRes.jsonrpc).toBe("2.0");
      expect(probeRes.result.content).toBeDefined();
      expect(probeRes.result.content.length).toBeGreaterThan(0);
      const probeText = probeRes.result.content[0].text;
      const probeManifest = JSON.parse(probeText) as {
        schemaVersion: number;
        tool: string;
        checks: unknown[];
      };
      expect(probeManifest.schemaVersion).toBe(1);
      expect(probeManifest.tool).toBe("kimi-doctor");
      expect(Array.isArray(probeManifest.checks)).toBe(true);
      probeCallReceived = true;
    } finally {
      try {
        stdin.end();
      } catch {
        // ignore
      }
      proc.kill("SIGTERM");
      try {
        await proc.exited;
      } catch {
        // ignore
      }
    }

    expect(initReceived).toBe(true);
    expect(toolsListReceived).toBe(true);
    expect(probeCallReceived).toBe(true);
  }, 10_000);

  test("doctor --adapter typecheck --json runs the typecheck adapter", async () => {
    const { stdout, exitCode } = await runTool(DOCTOR, ["--adapter", "typecheck", "--json"]);
    const report = JSON.parse(stdout.trim()) as {
      mode: string;
      adapter: string;
      checks: Array<{ name: string; status: string; message: string }>;
      summary: { errorCount: number };
    };
    expect(report.mode).toBe("adapter");
    expect(report.adapter).toBe("typecheck");
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.checks[0].name).toBe("typecheck");
    expect(report.summary).toBeDefined();
    expect(exitCode).toBe(0);
  }, 30_000);

  test("doctor --all --json runs every adapter and returns sources", async () => {
    const { stdout, exitCode } = await runTool(DOCTOR, ["--all", "--json"], 60_000);
    const report = JSON.parse(stdout.trim()) as {
      mode: string;
      checks: Array<{ name: string; status: string }>;
      sources: Record<string, unknown>;
      summary: { errorCount: number };
    };
    expect(report.mode).toBe("all");
    expect(report.checks.some((c) => c.name === "effect-gates")).toBe(true);
    expect(report.checks.some((c) => c.name === "typecheck")).toBe(true);
    expect(report.checks.some((c) => c.name === "oxlint")).toBe(true);
    expect(report.sources).toBeDefined();
    expect(Object.keys(report.sources).length).toBeGreaterThan(0);
    expect(report.summary).toBeDefined();
    expect(exitCode).toBe(0);
  }, 60_000);

  test("doctor --plugin runs a project-local plugin via --project-root", async () => {
    const tmpDir = mkdtempSync(join(REPO_ROOT, "node_modules", ".smoke-plugin-"));
    mkdirSync(join(tmpDir, ".kimi"), { recursive: true });
    const pluginScript = join(tmpDir, "plugin.ts");
    writeFileSync(
      pluginScript,
      `console.log(JSON.stringify({ checks: [{ name: "smoke-plugin", status: "ok", message: "from plugin", fixable: false }] }));`
    );
    writeFileSync(
      join(tmpDir, ".kimi", "doctor-plugins.json"),
      JSON.stringify({
        schemaVersion: 1,
        plugins: [{ name: "smoke-plugin", command: "bun", args: ["run", pluginScript] }],
      })
    );
    try {
      const { stdout, exitCode } = await runTool(
        DOCTOR,
        ["--plugin", "smoke-plugin", "--project-root", tmpDir, "--json"],
        15_000
      );
      const report = JSON.parse(stdout.trim()) as {
        mode: string;
        plugin: string;
        checks: Array<{ name: string; status: string; message: string }>;
      };
      expect(report.mode).toBe("plugin");
      expect(report.plugin).toBe("smoke-plugin");
      expect(report.checks[0]?.name).toBe("smoke-plugin");
      expect(report.checks[0]?.status).toBe("ok");
      expect(exitCode).toBe(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15_000);
});
