/**
 * Portfolio doctor — aggregate ecosystem health across registered projects.
 */

import { invokeTool } from "./tool-runner.ts";
import { listProjects, getProjectByAlias, type ProjectRecord } from "./project-registry.ts";
import { type HealthCheck } from "./health-check.ts";
import type { Logger } from "./logger.ts";

export interface PortfolioRunOptions {
  quick?: boolean;
  json?: boolean;
  strictWorkspace?: boolean;
  aliases?: string[];
  logger?: Logger;
}

export interface PortfolioProjectResult {
  alias: string;
  root: string;
  blockers: number;
  warnings: number;
  errors: number;
  checks: HealthCheck[];
  ok: boolean;
  durationMs: number;
}

export interface PortfolioReport {
  projects: PortfolioProjectResult[];
  summary: {
    total: number;
    blockers: number;
    warnings: number;
    errors: number;
    ok: boolean;
  };
}

async function runProjectEcosystem(
  project: ProjectRecord,
  quick: boolean
): Promise<PortfolioProjectResult> {
  const started = Date.now();
  const args = ["--ecosystem", "--json"];
  if (quick) args.push("--quick");
  const result = await invokeTool("kimi-doctor", args, {
    cwd: project.root,
    timeoutMs: 120_000,
  });

  const checks: HealthCheck[] = [];
  let blockers = 0;
  let warnings = 0;
  let errors = 0;

  if (result.exitCode === 0 && result.stdout) {
    try {
      const parsed = JSON.parse(result.stdout) as {
        checks?: HealthCheck[];
        ecosystem?: { blockers?: number; warnings?: number; errors?: number };
      };
      if (parsed.checks) checks.push(...parsed.checks);
      blockers = parsed.ecosystem?.blockers ?? 0;
      warnings = parsed.ecosystem?.warnings ?? 0;
      errors = parsed.ecosystem?.errors ?? 0;
    } catch {
      checks.push({
        name: "parse",
        status: "error",
        message: "could not parse doctor JSON",
        fixable: false,
      });
      errors = 1;
    }
  } else {
    checks.push({
      name: "doctor-run",
      status: "error",
      message: result.error || `exit ${result.exitCode}`,
      fixable: false,
    });
    errors = 1;
  }

  return {
    alias: project.alias,
    root: project.root,
    blockers,
    warnings,
    errors,
    checks,
    ok: blockers === 0,
    durationMs: Date.now() - started,
  };
}

export async function runPortfolioDoctor(
  options: PortfolioRunOptions = {}
): Promise<PortfolioReport> {
  const projects = options.aliases?.length
    ? options.aliases.map((a) => getProjectByAlias(a)).filter((p): p is ProjectRecord => p !== null)
    : listProjects();

  const results: PortfolioProjectResult[] = [];
  for (const project of projects) {
    results.push(await runProjectEcosystem(project, options.quick ?? true));
  }

  const summary = {
    total: results.length,
    blockers: results.reduce((s, r) => s + r.blockers, 0),
    warnings: results.reduce((s, r) => s + r.warnings, 0),
    errors: results.reduce((s, r) => s + r.errors, 0),
    ok: results.every((r) => r.ok),
  };

  return { projects: results, summary };
}

export function formatPortfolioReport(report: PortfolioReport): string {
  const lines: string[] = [];
  lines.push("Kimi Doctor — Portfolio Health");
  lines.push("");
  lines.push(
    `Projects: ${report.summary.total} | Blockers: ${report.summary.blockers} | Warnings: ${report.summary.warnings} | Errors: ${report.summary.errors}`
  );
  lines.push("");

  for (const project of report.projects) {
    const icon = project.ok ? "✓" : "✗";
    lines.push(
      `${icon} ${project.alias} (${project.root}) — ${project.blockers}b ${project.warnings}w ${project.errors}e · ${project.durationMs}ms`
    );
    for (const check of project.checks) {
      if (check.status === "ok") continue;
      const prefix = check.status === "error" ? "  ✗" : "  ⚠";
      lines.push(`${prefix} ${check.name}: ${check.message.slice(0, 120)}`);
    }
  }

  return lines.join("\n");
}
