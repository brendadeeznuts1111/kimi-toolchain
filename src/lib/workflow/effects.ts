/**
 * workflow/effects.ts — Active remediation and alerting handlers for workflow runs.
 */

import { dirname, join } from "path";
import { makeDir } from "../bun-io.ts";
import { createLogger, type Logger } from "../logger.ts";

function resolveWorkflowLogger(): Logger {
  return createLogger(Bun.argv, "kimi-workflow");
}
import { SemverMatcher } from "./semver-matcher.ts";
import { parseSemverIssueMessage } from "./scanners.ts";
import type { DriftMap, ScannerResult, WorkflowDomain, WorkflowEffects } from "./types.ts";

export interface AlertPayload {
  domain: string;
  timestamp: string;
  results: Array<{ scanner: string; status: string; issues: number }>;
  drift: DriftMap | null;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export type SpawnFn = (options: {
  cmd: string[];
  cwd?: string;
  stdout?: "ignore" | "pipe";
  stderr?: "pipe";
}) => { exited: Promise<number> };

export interface EffectDeps {
  fetch?: FetchFn;
  spawn?: SpawnFn;
  log?: (line: string) => void;
  findSafeVersion?: (pkg: string) => Promise<string | null>;
}

function defaultLog(line: string): void {
  resolveWorkflowLogger().info(line);
}

/** POST drift/run summary to a webhook URL. */
export async function sendAlert(
  domain: WorkflowDomain,
  results: ScannerResult[],
  drift: DriftMap | null,
  webhookUrl: string,
  deps: EffectDeps = {}
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const fetchImpl = deps.fetch ?? fetch;
  const payload: AlertPayload = {
    domain: domain.id,
    timestamp: new Date().toISOString(),
    results: results.map((row) => ({
      scanner: row.scannerId,
      status: row.status,
      issues: row.issues.length,
    })),
    drift,
  };

  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    log(`[${domain.id}] Alert sent to ${webhookUrl}`);
  } catch (err) {
    log(`[${domain.id}] Failed to send alert: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Resolve latest registry version for a package (override in tests). */
export async function findSafeVersion(
  pkg: string,
  fetchImpl: FetchFn = fetch
): Promise<string | null> {
  try {
    const response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`);
    if (!response.ok) return null;
    const data = (await response.json()) as { versions?: Record<string, unknown> };
    const versions = Object.keys(data.versions ?? {});
    return SemverMatcher.latest(versions);
  } catch {
    return null;
  }
}

/** Attempt semver upgrades for critical/high violations. */
export async function applyFixes(
  domain: WorkflowDomain,
  results: ScannerResult[],
  projectRoot: string,
  deps: EffectDeps = {}
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const spawnImpl = deps.spawn ?? Bun.spawn;
  const resolveVersion = deps.findSafeVersion ?? ((pkg: string) => findSafeVersion(pkg));

  for (const result of results) {
    if (result.scannerId !== "semver") continue;
    for (const issue of result.issues) {
      if (issue.severity !== "critical" && issue.severity !== "high") continue;

      const parsed =
        issue.package && issue.currentVersion
          ? { pkg: issue.package, version: issue.currentVersion }
          : parseSemverIssueMessage(issue.message);
      if (!parsed) continue;

      const safeVersion = await resolveVersion(parsed.pkg);
      if (!safeVersion) continue;

      log(
        `[${domain.id}] Attempting to upgrade ${parsed.pkg} from ${parsed.version} to ${safeVersion}`
      );
      const proc = spawnImpl({
        cmd: ["bun", "add", `${parsed.pkg}@${safeVersion}`],
        cwd: projectRoot,
        stdout: "ignore",
        stderr: "pipe",
      });
      await proc.exited;
    }
  }
}

export function formatWorkflowReport(
  domain: WorkflowDomain,
  results: ScannerResult[],
  drift: DriftMap | null
): string {
  const lines: string[] = [
    `# Workflow report: ${domain.id}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Scanner results",
    "",
  ];

  for (const result of results) {
    lines.push(`### ${result.scannerId} (${result.status})`);
    if (result.issues.length === 0) {
      lines.push("- no issues");
    } else {
      for (const issue of result.issues) {
        lines.push(`- **${issue.severity}:** ${issue.message}`);
      }
    }
    lines.push("");
  }

  if (drift && Object.keys(drift).length > 0) {
    lines.push("## Drift");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(drift, null, 2));
    lines.push("```");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

/** Write Markdown workflow report to disk. */
export async function generateReport(
  domain: WorkflowDomain,
  results: ScannerResult[],
  drift: DriftMap | null,
  reportPath: string,
  deps: EffectDeps = {}
): Promise<void> {
  const log = deps.log ?? defaultLog;
  makeDir(dirname(reportPath), { recursive: true });
  const report = formatWorkflowReport(domain, results, drift);
  await Bun.write(reportPath, report);
  log(`[${domain.id}] Report written to ${reportPath}`);
}

/** Run configured workflow effects after a scan completes. */
export async function runWorkflowEffects(
  domain: WorkflowDomain,
  results: ScannerResult[],
  drift: DriftMap | null,
  effects: WorkflowEffects | undefined,
  projectRoot: string,
  deps: EffectDeps = {}
): Promise<void> {
  const cfg = effects ?? {};
  const log = deps.log ?? defaultLog;

  if (cfg.log !== false && drift && Object.keys(drift).length > 0) {
    log(`[${domain.id}] Drift: ${JSON.stringify(drift)}`);
  }

  if (cfg.alert) {
    await sendAlert(domain, results, drift, cfg.alert, deps);
  }

  if (cfg.fix) {
    await applyFixes(domain, results, projectRoot, deps);
  }

  if (cfg.report) {
    const reportPath =
      typeof cfg.report === "string"
        ? cfg.report
        : join(projectRoot, "reports", `${domain.id}-workflow.md`);
    await generateReport(domain, results, drift, reportPath, deps);
  }
}

/** Fire effects without awaiting (watch loops). */
export function runWorkflowEffectsDetached(
  domain: WorkflowDomain,
  results: ScannerResult[],
  drift: DriftMap | null,
  effects: WorkflowEffects | undefined,
  projectRoot: string,
  deps: EffectDeps = {}
): void {
  void (async () => {
    try {
      await runWorkflowEffects(domain, results, drift, effects, projectRoot, deps);
    } catch (err) {
      const log = deps.log ?? defaultLog;
      log(
        `[${domain.id}] Effect handler failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  })();
}
