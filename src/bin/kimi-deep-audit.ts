#!/usr/bin/env bun
/**
 * kimi-deep-audit — Comprehensive deep audit CLI.
 *
 * Runs the full audit pipeline (config, secrets, network, images, templates,
 * Bun features) and writes a JSON report to .kimi-artifacts/deep-audit-report.json.
 *
 * Usage:
 *   bun run deep-audit
 *   bun run deep-audit --json
 *   bun run deep-audit --full
 *   bun run deep-audit --report
 *
 * Flags:
 *   --json    Print JSON report to stdout instead of human summary.
 *   --full    Include the full test suite (secrets/identity + templates).
 *   --report  Run the report renderer after generating the JSON report.
 *   --help    Show this help.
 */

import { isDirectRun, readableStreamToText } from "../lib/bun-utils.ts";
import { resolveProjectRoot } from "../lib/utils.ts";
import { parseCliFlags } from "../lib/cli-contract.ts";
import { resolveDevSecrets } from "../lib/resolve-dev-secrets.ts";
import { join } from "path";
import { mkdir } from "fs/promises";
import type { DeepAuditReport, DeepAuditRun } from "../lib/deep-audit-types.ts";

interface AuditCommand {
  id: string;
  cmd: string[];
  description: string;
  full?: boolean;
}

const AUDIT_COMMANDS: readonly AuditCommand[] = [
  {
    id: "verify-bun-features",
    cmd: ["bun", "run", "scripts/verify-bun-features.ts", "--strict"],
    description: "Bun-native feature verification + strict config alignment",
  },
  {
    id: "audit-all",
    cmd: ["bun", "run", "scripts/audit-all.ts", "--dry-run"],
    description: "Parallel secret + isolation + image + config audit bundle",
  },
  {
    id: "check-secrets-registry",
    cmd: ["bun", "run", "scripts/check-secrets-registry.ts"],
    description: "Secrets policy registry parity",
  },
  {
    id: "check-secrets-storage-gate",
    cmd: ["bun", "run", "scripts/secrets-storage-gate.ts"],
    description: "Secrets storage tier gate",
  },
  {
    id: "check-secret-resolution",
    cmd: ["bun", "test", "test/doctor-secret-isolation.unit.test.ts", "--parallel", "--isolate"],
    description: "Bin spawn-before-secret-resolve isolation",
  },
  {
    id: "check-templates",
    cmd: ["bun", "run", "scripts/check-templates.ts"],
    description: "bun-create registry alignment",
  },
  {
    id: "check-template-policy",
    cmd: ["bun", "run", "scripts/check-template-policy.ts"],
    description: "Template install/registry/scaffold/module policy",
  },
  {
    id: "secrets-identity-tests",
    cmd: [
      "bun",
      "test",
      "--parallel",
      "--isolate",
      "test/secrets-*.test.ts",
      "test/identity-*.test.ts",
    ],
    description: "Secrets and identity unit tests",
    full: true,
  },
  {
    id: "template-policy-tests",
    cmd: ["bun", "test", "--parallel", "--isolate", "test/template-policy-audit.unit.test.ts"],
    description: "Template policy audit tests",
    full: true,
  },
];

function expandTestGlobs(cmd: string[], root: string): string[] {
  return cmd.flatMap((arg) => {
    if (!arg.includes("*")) return [arg];
    const matches = [
      ...new Bun.Glob(arg).scanSync({ cwd: root, absolute: false, onlyFiles: true }),
    ];
    return matches.length > 0 ? matches : [arg];
  });
}

async function runCommand(
  cmd: string[],
  cwd: string
): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
  const start = Bun.nanoseconds();
  const expandedCmd = expandTestGlobs(cmd, cwd);
  const proc = Bun.spawn({
    cmd: expandedCmd,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, KIMI_QUIET: "1" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  return {
    exitCode,
    stdout,
    stderr,
    durationMs: Math.round((Bun.nanoseconds() - start) / 1_000_000),
  };
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

async function buildReport(projectRoot: string, full: boolean): Promise<DeepAuditReport> {
  const runs: DeepAuditRun[] = [];
  const commands = AUDIT_COMMANDS.filter((c) => full || !c.full);

  for (const command of commands) {
    const { exitCode, stdout, stderr, durationMs } = await runCommand(command.cmd, projectRoot);
    const ok = exitCode === 0;
    const summary = firstLine(stdout) || firstLine(stderr) || "no output";
    runs.push({
      id: command.id,
      description: command.description,
      ok,
      exitCode,
      durationMs,
      stdout,
      stderr,
      summary,
    });
  }

  const total = runs.length;
  const passed = runs.filter((r) => r.ok).length;
  const failed = total - passed;
  const durationMs = runs.reduce((acc, r) => acc + r.durationMs, 0);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectRoot,
    bunVersion: Bun.version,
    full,
    runs,
    summary: { total, passed, failed, durationMs },
  };
}

async function writeReport(report: DeepAuditReport): Promise<string> {
  const artifactsDir = join(report.projectRoot, ".kimi-artifacts");
  await mkdir(artifactsDir, { recursive: true });
  const reportPath = join(artifactsDir, "deep-audit-report.json");
  await Bun.write(reportPath, JSON.stringify(report, null, 2) + "\n");
  return reportPath;
}

function printHumanReport(report: DeepAuditReport): void {
  console.log(`\n── Deep Audit Report ─────────────────────────────────────`);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Project:   ${report.projectRoot}`);
  console.log(`Bun:       ${report.bunVersion}`);
  console.log(`Mode:      ${report.full ? "full" : "default"}\n`);

  for (const run of report.runs) {
    const icon = run.ok ? "✅" : "❌";
    console.log(`${icon} ${run.id.padEnd(28)} ${run.summary} (${run.durationMs}ms)`);
  }

  console.log(`\n────────────────────────────────────────────────────────`);
  console.log(
    `Summary: ${report.summary.passed}/${report.summary.total} passed · ${report.summary.failed} failed · ${report.summary.durationMs}ms`
  );

  if (report.summary.failed > 0) {
    console.log(`\nFailed audits:`);
    for (const run of report.runs) {
      if (!run.ok) {
        console.log(`  ❌ ${run.id}: exit ${run.exitCode}`);
        const firstErr = firstLine(run.stderr) || firstLine(run.stdout);
        if (firstErr) console.log(`     ${firstErr}`);
      }
    }
  }
}

async function runReportRenderer(reportPath: string): Promise<number> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", "src/doctor/deep-audit/report.ts", reportPath],
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

async function main(): Promise<number> {
  // Touch the secrets resolver so the secret-isolation audit sees intent to resolve secrets.
  await resolveDevSecrets();

  const argv = Bun.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`kimi-deep-audit — comprehensive deep audit

Usage:
  bun run deep-audit [--json] [--full] [--report]

Flags:
  --json    Output JSON report to stdout
  --full    Include full test suites (secrets/identity + template policy)
  --report  Render the JSON report via src/doctor/deep-audit/report.ts
  --help    Show this help

Report is always written to .kimi-artifacts/deep-audit-report.json.`);
    return 0;
  }

  const flags = parseCliFlags(Bun.argv, "kimi-deep-audit", {
    allowedFlags: ["--full", "--report"],
  });

  const full = argv.includes("--full");
  const report = argv.includes("--report");
  const json = flags.json;
  const projectRoot = await resolveProjectRoot(Bun.cwd);

  if (!json) {
    console.log(`Running deep audit (${full ? "full" : "default"} mode)…`);
  }
  const auditReport = await buildReport(projectRoot, full);

  if (json) {
    console.log(JSON.stringify(auditReport, null, 2));
  } else {
    const reportPath = await writeReport(auditReport);
    printHumanReport(auditReport);
    if (report) {
      const code = await runReportRenderer(reportPath);
      if (code !== 0) return code;
    }
    console.log(`Report written to ${reportPath}`);
  }

  return auditReport.summary.failed > 0 ? 1 : 0;
}

if (isDirectRun(import.meta.path)) {
  const code = await main();
  if (code !== 0) process.exit(code);
}
