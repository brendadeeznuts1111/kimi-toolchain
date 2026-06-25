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
 *   bun run deep-audit --webview
 *
 * Flags:
 *   --json     Print JSON report to stdout instead of human summary.
 *   --full     Include the full test suite (secrets/identity + templates).
 *   --report   Run the report renderer after generating the JSON report.
 *   --webview  Open the HTML report in a Bun.WebView window.
 *   --help     Show this help.
 */

import { Effect } from "effect";
import { isDirectRun, readableStreamToText } from "../lib/bun-utils.ts";
import { resolveProjectRoot } from "../lib/utils.ts";
import { parseCliFlags, writeStdoutLine } from "../lib/cli-contract.ts";
import { createLogger } from "../lib/logger.ts";

const logger = createLogger(Bun.argv, "kimi-deep-audit");
import { resolveDevSecrets } from "../lib/resolve-dev-secrets.ts";
import { join } from "path";
import { mkdir } from "fs/promises";
import type { DeepAuditReport, DeepAuditRun } from "../lib/deep-audit-types.ts";
import type { ImageAuditFinding } from "../lib/image-audit.ts";
import { showWebviewReport, waitForWebviewClose } from "../doctor/deep-audit/webview-report.ts";

interface AuditCommand {
  id: string;
  cmd: string[];
  description: string;
  full?: boolean;
  retries?: number;
}

const AUDIT_COMMANDS: readonly AuditCommand[] = [
  {
    id: "verify-bun-features",
    cmd: ["bun", "run", "scripts/verify-bun-features.ts", "--strict"],
    description: "Bun-native feature verification + strict config alignment",
    retries: 1,
  },
  {
    id: "audit-all",
    cmd: ["bun", "run", "scripts/audit-all.ts", "--dry-run"],
    description: "Parallel secret + isolation + image + config audit bundle",
  },
  {
    id: "audit-images",
    cmd: ["bun", "run", "scripts/audit-images.ts", "--json"],
    description: "Image asset entropy / metadata / geometry scan",
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

async function runCommandOnce(
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

async function runCommand(
  cmd: string[],
  cwd: string,
  retries = 0
): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
  let result = await runCommandOnce(cmd, cwd);
  while (retries > 0 && result.exitCode !== 0) {
    retries--;
    await Bun.sleep(500);
    const retry = await runCommandOnce(cmd, cwd);
    if (retry.exitCode === 0) return retry;
    result = retry;
  }
  return result;
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

function parseImageAuditJson(
  stdout: string
): { filesScanned: number; findings: ImageAuditFinding[] } | null {
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed.filesScanned === "number" && Array.isArray(parsed.findings)) {
      return { filesScanned: parsed.filesScanned, findings: parsed.findings };
    }
  } catch {
    // stdout is not JSON or does not match image-audit shape
  }
  return null;
}

async function buildReport(projectRoot: string, full: boolean): Promise<DeepAuditReport> {
  const runs: DeepAuditRun[] = [];
  const commands = AUDIT_COMMANDS.filter((c) => full || !c.full);

  for (const command of commands) {
    const { exitCode, stdout, stderr, durationMs } = await runCommand(
      command.cmd,
      projectRoot,
      command.retries
    );
    const ok = exitCode === 0;
    const summary = firstLine(stdout) || firstLine(stderr) || "no output";
    const run: DeepAuditRun = {
      id: command.id,
      description: command.description,
      ok,
      exitCode,
      durationMs,
      stdout,
      stderr,
      summary,
    };

    if (command.id === "audit-images") {
      const imageAudit = parseImageAuditJson(stdout);
      if (imageAudit) {
        run.filesScanned = imageAudit.filesScanned;
        run.findings = imageAudit.findings;
        run.summary = `${imageAudit.filesScanned} image(s) scanned · ${imageAudit.findings.length} finding(s)`;
      }
    }

    runs.push(run);
  }

  const total = runs.length;
  const passed = runs.filter((r) => r.ok).length;
  const failed = total - passed;
  const durationMs = runs.reduce((acc, r) => acc + r.durationMs, 0);

  const imageAuditRun = runs.find((r) => r.id === "audit-images");
  const imageAudit =
    imageAuditRun && imageAuditRun.filesScanned !== undefined
      ? { filesScanned: imageAuditRun.filesScanned, findings: imageAuditRun.findings ?? [] }
      : undefined;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectRoot,
    bunVersion: Bun.version,
    full,
    runs,
    summary: { total, passed, failed, durationMs },
    imageAudit,
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
  logger.info(`\n── Deep Audit Report ─────────────────────────────────────`);
  logger.info(`Generated: ${report.generatedAt}`);
  logger.info(`Project:   ${report.projectRoot}`);
  logger.info(`Bun:       ${report.bunVersion}`);
  logger.info(`Mode:      ${report.full ? "full" : "default"}\n`);

  for (const run of report.runs) {
    const icon = run.ok ? "✅" : "❌";
    logger.info(`${icon} ${run.id.padEnd(28)} ${run.summary} (${run.durationMs}ms)`);
  }

  logger.info(`\n────────────────────────────────────────────────────────`);
  logger.info(
    `Summary: ${report.summary.passed}/${report.summary.total} passed · ${report.summary.failed} failed · ${report.summary.durationMs}ms`
  );

  if (report.imageAudit) {
    const { filesScanned, findings } = report.imageAudit;
    logger.info(`\nImage audit: ${filesScanned} file(s) scanned · ${findings.length} finding(s)`);
    for (const finding of findings) {
      logger.info(`  [${finding.taxonomyId}] ${finding.file}: ${finding.message}`);
    }
  }

  if (report.summary.failed > 0) {
    logger.info(`\nFailed audits:`);
    for (const run of report.runs) {
      if (!run.ok) {
        logger.info(`  ❌ ${run.id}: exit ${run.exitCode}`);
        const firstErr = firstLine(run.stderr) || firstLine(run.stdout);
        if (firstErr) logger.info(`     ${firstErr}`);
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
  await Effect.runPromise(resolveDevSecrets());

  const argv = Bun.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    logger.info(`kimi-deep-audit — comprehensive deep audit

Usage:
  bun run deep-audit [--json] [--full] [--report] [--webview]

Flags:
  --json     Output JSON report to stdout
  --full     Include full test suites (secrets/identity + template policy)
  --report   Render the JSON report via src/doctor/deep-audit/report.ts
  --webview  Open the HTML report in a Bun.WebView window
  --help     Show this help

Report is always written to .kimi-artifacts/deep-audit-report.json.`);
    return 0;
  }

  const flags = parseCliFlags(Bun.argv, "kimi-deep-audit", {
    allowedFlags: ["--full", "--report", "--webview"],
  });

  const full = argv.includes("--full");
  const report = argv.includes("--report");
  const webview = argv.includes("--webview");
  const json = flags.json;
  const projectRoot = await resolveProjectRoot(Bun.cwd);

  if (!json) {
    logger.info(`Running deep audit (${full ? "full" : "default"} mode)…`);
  }
  const auditReport = await buildReport(projectRoot, full);

  if (json) {
    await writeStdoutLine(JSON.stringify(auditReport, null, 2));
  } else {
    const reportPath = await writeReport(auditReport);
    printHumanReport(auditReport);
    if (report) {
      const code = await runReportRenderer(reportPath);
      if (code !== 0) return code;
    }
    let webviewView: Bun.WebView | null = null;
    if (webview) {
      try {
        const result = await showWebviewReport(auditReport);
        webviewView = result.view;
        logger.info(`Webview report opened from ${result.htmlPath}`);
        logger.info("Press Ctrl+C to close the webview window.");
      } catch (err) {
        logger.error(`Failed to open webview: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }
    }
    logger.info(`Report written to ${reportPath}`);
    if (webviewView) {
      await waitForWebviewClose(webviewView);
    }
  }

  return auditReport.summary.failed > 0 ? 1 : 0;
}

if (isDirectRun(import.meta.path)) {
  const code = await main();
  if (code !== 0) process.exit(code);
}
