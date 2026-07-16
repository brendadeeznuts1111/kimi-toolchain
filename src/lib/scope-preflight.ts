/**
 * Automatable SCOPE preflight checks — docs/SCOPE.md steps 1 (partial).
 */

import { join } from "path";
import { pathExists } from "./bun-io.ts";
import { invokeTool, withBunNoOrphans } from "./tool-runner.ts";
import { withNoOrphansEnv } from "./bun-spawn-env.ts";
import { auditSkillCoverage, ORCHESTRATOR_EVENT_ACTIONS } from "./skill-contract.ts";
import { resolveOrchestratorConfig } from "./herdr-orchestrator-config.ts";
import { discoverHerdrProjectConfig } from "./herdr-project-config.ts";
import { TOML } from "bun";
import { readText } from "./bun-io.ts";

export interface ScopeCheckResult {
  id: string;
  section: string;
  command: string;
  ok: boolean;
  message: string;
  scopeItem?: string;
  details?: Record<string, unknown>;
}

export interface ScopePreflightReport {
  schemaVersion: 1;
  tool: "scope-preflight";
  generatedAt: string;
  projectRoot: string;
  ok: boolean;
  passed: number;
  failed: number;
  skipped: number;
  checks: ScopeCheckResult[];
}

function loadTomlDoc(sourcePath: string | null): Record<string, unknown> | null {
  if (!sourcePath || !pathExists(sourcePath)) return null;
  try {
    return TOML.parse(readText(sourcePath)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Compare live `status --json` config to `resolveOrchestratorConfig` for docs/SCOPE docs alignment. */
export function compareOrchestratorConfigParity(
  projectRoot: string,
  statusConfig: Record<string, unknown>
): { ok: boolean; message: string } {
  const herdr = discoverHerdrProjectConfig(projectRoot);
  if (!herdr) return { ok: false, message: "no [herdr] profile in project" };

  const doc = loadTomlDoc(herdr.sourcePath);
  const expected = resolveOrchestratorConfig({ ...herdr, projectPath: projectRoot }, doc);
  const events = statusConfig.events as { enabled?: boolean; allowlist?: string[] } | undefined;

  if (statusConfig.enabled !== expected.enabled) {
    return { ok: false, message: "status.config.enabled differs from resolveOrchestratorConfig" };
  }
  if (statusConfig.handoffFrom !== expected.handoffFrom) {
    return { ok: false, message: "handoffFrom mismatch between status and resolver" };
  }
  if (statusConfig.handoffTo !== expected.handoffTo) {
    return { ok: false, message: "handoffTo mismatch between status and resolver" };
  }
  if (events?.enabled !== expected.events.enabled) {
    return { ok: false, message: "events.enabled mismatch between status and resolver" };
  }

  const statusAllow = [...(events?.allowlist ?? [])].sort();
  const expectedAllow = [...(expected.events.allowlist ?? [])].sort();
  if (statusAllow.join(",") !== expectedAllow.join(",")) {
    return {
      ok: false,
      message: `allowlist mismatch: status=[${statusAllow.join(", ")}] resolver=[${expectedAllow.join(", ")}]`,
    };
  }

  return {
    ok: true,
    message: "dx.config.toml orchestrator block matches resolveOrchestratorConfig",
  };
}

/** Event names routed in code must appear in configured allowlist when events enabled. */
export function validateOrchestratorAllowlistCoversRoutes(allowlist: string[] | undefined): {
  ok: boolean;
  message: string;
  missing: string[];
} {
  const list = allowlist ?? [];
  const missing = Object.keys(ORCHESTRATOR_EVENT_ACTIONS).filter((event) => !list.includes(event));
  return {
    ok: missing.length === 0,
    message:
      missing.length === 0
        ? "allowlist covers all routeOrchestratorEvent table events"
        : `allowlist missing routed events: ${missing.join(", ")}`,
    missing,
  };
}

async function runBunScript(
  repoRoot: string,
  script: string,
  args: string[] = []
): Promise<{ exitCode: number; stdout: string }> {
  const result = await invokeTool(join(repoRoot, script), args, {
    cwd: repoRoot,
    timeoutMs: 120_000,
    maxOutputBytes: 2_000_000,
  });
  return { exitCode: result.exitCode, stdout: result.stdout + result.stderr };
}

/** Run automatable SCOPE preflight checks (no live handoff / persistence). */
export async function runScopePreflight(repoRoot: string): Promise<ScopePreflightReport> {
  const checks: ScopeCheckResult[] = [];
  const orchestratorBin = join(repoRoot, "src/bin/herdr-orchestrator.ts");
  const doctorBin = join(repoRoot, "src/bin/kimi-doctor.ts");

  const add = (check: ScopeCheckResult) => {
    checks.push(check);
  };

  // verify:desktop-runtime
  {
    const cmd = "bun run verify:desktop-runtime";
    const { exitCode, stdout } = await runBunScript(repoRoot, "scripts/verify-desktop-runtime.ts");
    add({
      id: "verify-desktop-runtime",
      section: "Preflight",
      command: cmd,
      scopeItem: "bun run sync && bun run verify:desktop-runtime",
      ok: exitCode === 0,
      message: exitCode === 0 ? "desktop runtime in sync" : stdout.trim().slice(0, 200),
    });
  }

  // effect-gates
  {
    const cmd = "kimi-doctor --effect-gates --json";
    const { exitCode, stdout } = await invokeTool(doctorBin, ["--effect-gates", "--json"], {
      cwd: repoRoot,
      timeoutMs: 60_000,
    });
    let ok = exitCode === 0;
    let message = "effect-gates failed";
    try {
      const parsed = JSON.parse(stdout) as { summary?: { ok?: boolean } };
      ok = parsed.summary?.ok === true;
      message = ok ? "summary.ok true" : "summary.ok false";
    } catch {
      message = "invalid effect-gates JSON";
    }
    add({
      id: "effect-gates",
      section: "Preflight",
      command: cmd,
      scopeItem: "kimi-doctor --effect-gates --json",
      ok,
      message,
    });
  }

  // skill coverage
  {
    const cmd = "bun run lint:skills";
    const report = await auditSkillCoverage(repoRoot);
    add({
      id: "skill-coverage",
      section: "Docs alignment",
      command: cmd,
      scopeItem: "skill-contract / lint:skills",
      ok: report.ok,
      message: report.ok ? "lint:skill-coverage OK" : "skill coverage gate failed",
      details: { skills: report.rows.map((r) => r.skill) },
    });
  }

  // herdr unit tests (fast subset from SCOPE)
  {
    const cmd =
      "bun test test/herdr-orchestrator.unit.test.ts test/herdr-orchestrator-events.unit.test.ts";
    const proc = Bun.spawn(
      withBunNoOrphans([
        "bun",
        "test",
        "test/herdr-orchestrator.unit.test.ts",
        "test/herdr-orchestrator-events.unit.test.ts",
      ]),
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe", env: withNoOrphansEnv() }
    );
    const exitCode = await proc.exited;
    add({
      id: "herdr-unit-tests",
      section: "Preflight",
      command: cmd,
      scopeItem: "bun test herdr-orchestrator*.unit.test.ts",
      ok: exitCode === 0,
      message: exitCode === 0 ? "herdr orchestrator unit tests pass" : `exit ${exitCode}`,
    });
  }

  // orchestrator status JSON
  {
    const cmd = "herdr-orchestrator status . --json";
    const { exitCode, stdout } = await invokeTool(orchestratorBin, ["status", ".", "--json"], {
      cwd: repoRoot,
      timeoutMs: 30_000,
    });
    let ok = exitCode === 0;
    let message = "status command failed";
    let details: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(stdout.trim()) as {
        ok?: boolean;
        config?: Record<string, unknown>;
      };
      ok = parsed.ok === true && parsed.config?.enabled === true;
      message = ok ? "orchestrator enabled in status JSON" : "status JSON missing enabled config";
      details = { handoffFrom: parsed.config?.handoffFrom, handoffTo: parsed.config?.handoffTo };

      if (parsed.config) {
        const parity = compareOrchestratorConfigParity(repoRoot, parsed.config);
        add({
          id: "orchestrator-config-parity",
          section: "Docs alignment",
          command: "resolveOrchestratorConfig vs status --json",
          scopeItem: "dx.config.toml matches herdr-orchestrator status --json",
          ok: parity.ok,
          message: parity.message,
        });

        const events = parsed.config.events as { allowlist?: string[] } | undefined;
        const routes = validateOrchestratorAllowlistCoversRoutes(events?.allowlist);
        add({
          id: "orchestrator-allowlist-routes",
          section: "Docs alignment",
          command: "routeOrchestratorEvent allowlist coverage",
          scopeItem: "orchestrator skill event table ⊆ allowlist",
          ok: routes.ok,
          message: routes.message,
          details: { missing: routes.missing },
        });
      }
    } catch {
      ok = false;
      message = "invalid status JSON";
    }
    add({
      id: "orchestrator-status",
      section: "Orchestrator bootstrap",
      command: cmd,
      scopeItem: "herdr-orchestrator status — enabled, handoff targets",
      ok,
      message,
      details,
    });
  }

  // finish-work-status fixture
  {
    const cmd = "bun run scripts/finish-work-status.ts --json --project <tmp>";
    const tmp = join(repoRoot, `.tmp-scope-fw-${Date.now()}`);
    const kimiDir = join(tmp, ".kimi");
    await Bun.write(
      join(kimiDir, "finish-work-report.json"),
      JSON.stringify(
        {
          schemaVersion: "1.1",
          timestamp: new Date().toISOString(),
          agent: "kimi",
          paneId: "wB:p6F",
          durationMs: 100,
          git: { committed: true, pushed: true, hash: "abc1234", branch: "main" },
          tree: { clean: true, dirtyFiles: [], untracked: 0 },
          gates: { "check:fast": { status: "pass", durationMs: 100 } },
          outcome: "clean",
          outcomeReason: "fixture",
          review: {
            escalated: false,
            reviewerPane: null,
            reportPath: ".kimi/finish-work-report.json",
          },
          handoffCandidate: {
            shouldHandoff: true,
            targetAgent: "codex-primary",
            targetPane: "wB:p6G",
            reason: "fixture",
          },
          summary: "scope fixture",
        },
        null,
        2
      )
    );
    const { exitCode, stdout } = await runBunScript(repoRoot, "scripts/finish-work-status.ts", [
      "--json",
      "--project",
      tmp,
    ]);
    let ok = exitCode === 0;
    try {
      const parsed = JSON.parse(stdout.trim()) as { ok?: boolean };
      ok = parsed.ok === true;
    } catch {
      ok = false;
    }
    add({
      id: "finish-work-status",
      section: "Handoff",
      command: cmd,
      scopeItem: "finish-work report readable via finish-work-status.ts",
      ok,
      message: ok ? "v1.1 fixture report validates" : `exit ${exitCode}`,
    });
    try {
      await Bun.$`rm -rf ${tmp}`.quiet();
    } catch {
      // best-effort cleanup
    }
  }

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok).length;

  return {
    schemaVersion: 1,
    tool: "scope-preflight",
    generatedAt: new Date().toISOString(),
    projectRoot: repoRoot,
    ok: failed === 0,
    passed,
    failed,
    skipped: 0,
    checks,
  };
}

export function formatScopePreflightReport(report: ScopePreflightReport): string {
  const lines = [
    report.ok ? "scope-preflight OK" : `scope-preflight FAIL (${report.failed} failed)`,
    `passed ${report.passed}/${report.checks.length} at ${report.generatedAt}`,
  ];
  for (const check of report.checks) {
    lines.push(
      `${check.ok ? "✓" : "✗"} [${check.section}] ${check.id}: ${check.message} (${check.command})`
    );
  }
  return lines.join("\n");
}
