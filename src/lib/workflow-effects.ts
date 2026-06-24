/**
 * workflow-effects.ts — Effect handlers for workflow loops (Log, Alert, Fix, Report).
 *
 * Provides typed effect handlers that compose with herdr orchestrators, governance
 * preflight, and the kimi-doctor auto-fix pipeline. Each handler is registered as an
 * effect benchmark for closed-loop performance tracking.
 *
 * Bun-native APIs: fetch (alerts), Bun.spawn / Bun.$ (fixes), Bun.write (reports),
 * console.error (logs). Zero npm dependencies.
 *
 * @see src/lib/effect-benchmark.ts for registration pattern
 * @see src/harness/effect-handlers.ts for built-in benchmarks
 * @see src/bin/kimi-doctor.ts applyFixes() for doctor auto-fix integration
 */

import { registerEffectBenchmark } from "./effect-benchmark.ts";
import { $ } from "bun";

// ── Types ───────────────────────────────────────────────────────────────

/** Severity level for issues that effect handlers react to. */
export type WorkflowSeverity = "critical" | "high" | "medium" | "low" | "info";

/** A single issue detected by a scanner or check. */
export interface WorkflowIssue {
  /** Unique issue identifier (e.g. CVE id, taxonomy code). */
  id: string;
  /** Human-readable message. */
  message: string;
  severity: WorkflowSeverity;
  /** Package or component name, when applicable. */
  package?: string;
  /** Current detected version, when applicable. */
  currentVersion?: string;
  /** Recommended target version, when known. */
  targetVersion?: string;
}

/** Result from a single scanner pass. */
export interface WorkflowScanResult {
  scannerId: string;
  status: "ok" | "warn" | "error";
  issues: WorkflowIssue[];
}

/** Structured drift between current state and baseline. */
export type WorkflowDrift = Record<string, unknown>;

/** Input payload for all effect handlers. */
export interface WorkflowEffectContext {
  /** Logical domain or project identifier. */
  domainId: string;
  /** Scan results from the current pass. */
  results: WorkflowScanResult[];
  /** Drift delta from baseline, or null if no baseline. */
  drift: WorkflowDrift | null;
  /** ISO timestamp of the scan. */
  timestamp: string;
  /** Bun runtime metadata — auto-injected by runWorkflowEffects. */
  bun?: WorkflowBunMetadata;
  /** TLS configuration for outbound effect calls (alerts, registry queries). */
  tls?: WorkflowTlsConfig;
}

/** Bun runtime metadata injected into every effect context. */
export interface WorkflowBunMetadata {
  version: string;
  revision: string | null;
  platform: string;
}

/** TLS configuration for secure outbound effect calls. */
export interface WorkflowTlsConfig {
  /** Path to CA certificate file (PEM). */
  ca?: string;
  /** Path to client certificate file (PEM). */
  cert?: string;
  /** Path to client private key file (PEM). */
  key?: string;
  /** Reject unauthorized TLS certificates (default: true). */
  rejectUnauthorized?: boolean;
}

/** Configuration for effect handlers. */
export interface WorkflowEffectOptions {
  /** Enable log output to stderr (default: true). */
  log?: boolean;
  /** Webhook URL for alert notifications. */
  alertUrl?: string;
  /** Attempt automatic fixes for critical/high issues. */
  fix?: boolean;
  /** Generate a report file. true → default path, string → custom path. */
  report?: boolean | string;
}

// ── Log Effect ───────────────────────────────────────────────────────────

/**
 * Emit structured log output for scan results and drift.
 * Always writes to stderr to avoid polluting stdout pipelines.
 */
export function logEffect(ctx: WorkflowEffectContext): void {
  const totalIssues = ctx.results.reduce((sum, r) => sum + r.issues.length, 0);
  const criticalIssues = ctx.results.reduce(
    (sum, r) => sum + r.issues.filter((i) => i.severity === "critical").length,
    0
  );

  console.error(
    `[${ctx.domainId}] ${ctx.timestamp} — ${totalIssues} issue(s), ${criticalIssues} critical`
  );

  for (const result of ctx.results) {
    if (result.issues.length === 0) continue;
    for (const issue of result.issues) {
      const prefix = issue.severity === "critical" ? "🚨" : issue.severity === "high" ? "⚠️" : "ℹ️";
      console.error(`  ${prefix} [${result.scannerId}] ${issue.message}`);
    }
  }

  if (ctx.drift && Object.keys(ctx.drift).length > 0) {
    console.error(`[${ctx.domainId}] Drift:`, ctx.drift);
  }
}

registerEffectBenchmark({
  registryKey: "workflow.effect.log",
  symbol: "kimi.effect.workflow.log",
  operation: "logEffect",
  sourceFile: "src/lib/workflow-effects.ts",
  sourceDescription: "Structured log output to stderr for scan results and drift",
  workload: () => {
    logEffect({
      domainId: "test",
      results: [
        {
          scannerId: "semver",
          status: "warn",
          issues: [
            {
              id: "DEP-001",
              message: "lodash@4.17.20 is deprecated",
              severity: "high",
              package: "lodash",
              currentVersion: "4.17.20",
            },
            {
              id: "CVE-2024-001",
              message: "express@4.18.2 has CVE",
              severity: "critical",
              package: "express",
              currentVersion: "4.18.2",
            },
          ],
        },
      ],
      drift: { packagesChanged: 2 },
      timestamp: new Date().toISOString(),
    });
  },
});

// ── Alert Effect ──────────────────────────────────────────────────────────

/** Payload sent to alert webhooks. */
export interface AlertPayload {
  domain: string;
  timestamp: string;
  bun?: WorkflowBunMetadata;
  results: Array<{ scanner: string; status: string; issues: number }>;
  drift: WorkflowDrift | null;
}

/**
 * Send alert notification to a webhook URL (Slack, Discord, etc.).
 * Uses Bun-native fetch with a 5-second timeout and optional TLS config.
 * Non-blocking — failures are logged but do not throw.
 */
export async function alertEffect(
  ctx: WorkflowEffectContext,
  webhookUrl: string
): Promise<{ ok: boolean; error?: string }> {
  const payload: AlertPayload = {
    domain: ctx.domainId,
    timestamp: ctx.timestamp,
    bun: ctx.bun,
    results: ctx.results.map((r) => ({
      scanner: r.scannerId,
      status: r.status,
      issues: r.issues.length,
    })),
    drift: ctx.drift,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    };

    // Apply TLS configuration when provided
    if (ctx.tls) {
      const tlsInit = init as RequestInit & {
        tls?: { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean };
      };
      tlsInit.tls = {
        ca: ctx.tls.ca,
        cert: ctx.tls.cert,
        key: ctx.tls.key,
        rejectUnauthorized: ctx.tls.rejectUnauthorized ?? true,
      };
    }

    const response = await fetch(webhookUrl, init);
    clearTimeout(timeout);

    const ok = response.ok;
    if (ok) {
      console.error(`[${ctx.domainId}] Alert sent to ${webhookUrl}`);
    } else {
      console.error(`[${ctx.domainId}] Alert failed: HTTP ${response.status}`);
    }
    return { ok };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${ctx.domainId}] Alert failed: ${message}`);
    return { ok: false, error: message };
  }
}

registerEffectBenchmark({
  registryKey: "workflow.effect.alert",
  symbol: "kimi.effect.workflow.alert",
  operation: "alertEffect",
  sourceFile: "src/lib/workflow-effects.ts",
  sourceDescription: "Send webhook alert via Bun-native fetch with 5s timeout",
  workload: async () => {
    // Test with an unreachable URL to exercise the error path
    await alertEffect(
      {
        domainId: "test",
        results: [
          {
            scannerId: "semver",
            status: "warn",
            issues: [{ id: "X", message: "test", severity: "high" }],
          },
        ],
        drift: null,
        timestamp: new Date().toISOString(),
      },
      "http://127.0.0.1:1/alert" // guaranteed unreachable
    );
  },
});

// ── Fix Effect ────────────────────────────────────────────────────────────

/** Result of an attempted fix. */
export interface FixResult {
  package: string;
  fromVersion: string;
  toVersion: string | null;
  success: boolean;
  error?: string;
}

/**
 * Attempt automatic remediation for critical and high-severity issues.
 * Uses `bun add <pkg>@<version>` via Bun.$ for safe shell execution.
 * Falls back to Bun.spawn when target version is known.
 */
export async function fixEffect(
  ctx: WorkflowEffectContext,
  projectDir: string = process.cwd()
): Promise<FixResult[]> {
  const results: FixResult[] = [];

  for (const result of ctx.results) {
    if (result.scannerId !== "semver" && result.scannerId !== "governance") continue;

    for (const issue of result.issues) {
      if (issue.severity !== "critical" && issue.severity !== "high") continue;
      if (!issue.package) continue;

      const targetVersion = issue.targetVersion ?? (await findLatestVersion(issue.package));
      if (!targetVersion) {
        results.push({
          package: issue.package,
          fromVersion: issue.currentVersion ?? "unknown",
          toVersion: null,
          success: false,
          error: "No safe target version found",
        });
        continue;
      }

      try {
        const result = await $`bun add ${issue.package}@${targetVersion}`
          .cwd(projectDir)
          .nothrow()
          .quiet();

        const ok = result.exitCode === 0;
        if (ok) {
          console.error(
            `[${ctx.domainId}] Fixed ${issue.package}: ${issue.currentVersion ?? "?"} → ${targetVersion}`
          );
        } else {
          console.error(
            `[${ctx.domainId}] Fix failed for ${issue.package}: ${result.stderr.toString().trim()}`
          );
        }

        results.push({
          package: issue.package,
          fromVersion: issue.currentVersion ?? "unknown",
          toVersion: targetVersion,
          success: ok,
          error: ok ? undefined : `bun add exited ${result.exitCode}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          package: issue.package,
          fromVersion: issue.currentVersion ?? "unknown",
          toVersion: targetVersion,
          success: false,
          error: message,
        });
      }
    }
  }

  return results;
}

/** Query npm registry for the latest version of a package. */
async function findLatestVersion(pkg: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`https://registry.npmjs.org/${pkg}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const data = (await response.json()) as { versions?: Record<string, unknown> };
    if (!data.versions) return null;

    const versions = Object.keys(data.versions);
    if (versions.length === 0) return null;

    // Sort by semver order (latest first)
    return (
      versions.sort((a, b) => {
        try {
          return Bun.semver.order(b, a);
        } catch {
          return 0;
        }
      })[0] ?? null
    );
  } catch {
    return null;
  }
}

registerEffectBenchmark({
  registryKey: "workflow.effect.fix",
  symbol: "kimi.effect.workflow.fix",
  operation: "fixEffect",
  sourceFile: "src/lib/workflow-effects.ts",
  sourceDescription: "Auto-remediate critical/high issues via bun add + npm registry lookup",
  workload: async () => {
    await fixEffect(
      {
        domainId: "test",
        results: [
          {
            scannerId: "semver",
            status: "warn",
            issues: [
              {
                id: "DEP-TEST",
                message: "typescript@5.0.0 is outdated",
                severity: "high",
                package: "typescript",
                currentVersion: "5.0.0",
                targetVersion: "latest",
              },
            ],
          },
        ],
        drift: null,
        timestamp: new Date().toISOString(),
      },
      process.cwd()
    );
  },
  skipIf: () => Bun.env.CI === "true",
  skipReason: "CI: skip network-dependent fix benchmark",
});

// ── Report Effect ─────────────────────────────────────────────────────────

/** Default directory for workflow reports. */
const DEFAULT_REPORT_DIR = "reports";

/**
 * Generate a Markdown report from scan results and drift.
 * Uses Bun.write for atomic file output. Uses Bun.inspect.table for
 * structured issue rendering within the Markdown body.
 */
export async function reportEffect(
  ctx: WorkflowEffectContext,
  reportPath?: string
): Promise<string> {
  const path = reportPath ?? `${DEFAULT_REPORT_DIR}/${ctx.domainId}-workflow.md`;

  const totalIssues = ctx.results.reduce((sum, r) => sum + r.issues.length, 0);
  const criticalIssues = ctx.results.reduce(
    (sum, r) => sum + r.issues.filter((i) => i.severity === "critical").length,
    0
  );
  const highIssues = ctx.results.reduce(
    (sum, r) => sum + r.issues.filter((i) => i.severity === "high").length,
    0
  );

  const scanRows = ctx.results.map((r) => ({
    Scanner: r.scannerId,
    Status: r.status,
    Issues: r.issues.length,
  }));

  const issueRows = ctx.results.flatMap((r) =>
    r.issues.map((i) => ({
      Severity: i.severity,
      ID: i.id,
      Message: i.message,
      Package: i.package ?? "—",
    }))
  );

  const table = Bun.inspect.table as (rows: object[], opts?: { headers?: boolean }) => string;

  const lines = [`# Workflow Report: ${ctx.domainId}`, `**Timestamp:** ${ctx.timestamp}`, ""];

  if (ctx.bun) {
    lines.push(
      `**Bun:** ${ctx.bun.version} (${ctx.bun.revision ?? "unknown"}) on ${ctx.bun.platform}`,
      ""
    );
  }

  const scannerTable = table(scanRows, { headers: true });

  lines.push(
    "## Summary",
    `- Total issues: **${totalIssues}**`,
    `- Critical: **${criticalIssues}**`,
    `- High: **${highIssues}**`,
    "",
    "## Scanners",
    scannerTable,
    ""
  );

  if (issueRows.length > 0) {
    lines.push(`## Issues`, table(issueRows, { headers: true }), "");
  }

  if (ctx.drift && Object.keys(ctx.drift).length > 0) {
    lines.push(`## Drift`, "```json", JSON.stringify(ctx.drift, null, 2), "```", "");
  }

  const dir = path.substring(0, path.lastIndexOf("/"));
  if (dir) {
    const { makeDir } = await import("./bun-io.ts");
    makeDir(dir, { recursive: true });
  }

  await Bun.write(path, lines.join("\n"));
  console.error(`[${ctx.domainId}] Report written to ${path}`);

  return path;
}

registerEffectBenchmark({
  registryKey: "workflow.effect.report",
  symbol: "kimi.effect.workflow.report",
  operation: "reportEffect",
  sourceFile: "src/lib/workflow-effects.ts",
  sourceDescription: "Generate Markdown report with Bun.inspect.table + Bun.write",
  workload: async () => {
    await reportEffect({
      domainId: "test",
      results: [
        {
          scannerId: "semver",
          status: "warn",
          issues: [
            { id: "DEP-001", message: "lodash outdated", severity: "high", package: "lodash" },
          ],
        },
        {
          scannerId: "governance",
          status: "error",
          issues: [{ id: "GOV-001", message: "lockfile stale", severity: "critical" }],
        },
      ],
      drift: { packagesChanged: 3, lockfileHash: "abc123" },
      timestamp: new Date().toISOString(),
    });
  },
});

// ── Orchestrator ──────────────────────────────────────────────────────────

/**
 * Run all enabled effect handlers for a workflow pass.
 * Log is always run. Alert, fix, and report are conditional on options.
 * Bun runtime metadata is auto-injected into the context.
 */
export async function runWorkflowEffects(
  ctx: WorkflowEffectContext,
  options: WorkflowEffectOptions = {}
): Promise<{
  logRan: boolean;
  alertResult?: { ok: boolean; error?: string };
  fixResults?: FixResult[];
  reportPath?: string;
}> {
  // Auto-inject Bun runtime metadata
  if (!ctx.bun) {
    ctx.bun = {
      version: Bun.version,
      revision: typeof Bun.revision === "string" && Bun.revision.length > 0 ? Bun.revision : null,
      platform: process.platform,
    };
  }

  const result: {
    logRan: boolean;
    alertResult?: { ok: boolean; error?: string };
    fixResults?: FixResult[];
    reportPath?: string;
  } = { logRan: true };

  // Log always runs unless explicitly disabled
  if (options.log !== false) {
    logEffect(ctx);
  } else {
    result.logRan = false;
  }

  // Alert
  if (options.alertUrl) {
    result.alertResult = await alertEffect(ctx, options.alertUrl);
  }

  // Fix
  if (options.fix) {
    result.fixResults = await fixEffect(ctx);
  }

  // Report
  if (options.report) {
    const reportPath = typeof options.report === "string" ? options.report : undefined;
    result.reportPath = await reportEffect(ctx, reportPath);
  }

  return result;
}
