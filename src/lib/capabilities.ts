/**
 * Live capability probing for MCP, hooks, credentials, and contracts.
 */

import { Data, Effect } from "effect";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { capabilitySnapshotsDir, configTomlPath, failureLedgerPath, mcpPath } from "./paths.ts";
import { safeParse } from "./utils.ts";
import { auditContractTrust } from "./contract-signing.ts";
import { queryDecisionLedger, recordDecision } from "./decision-ledger.ts";

export type CapabilityStatus = "healthy" | "degraded" | "unavailable";
export type CapabilityType = "mcp" | "hook" | "credential" | "contract";

export class CapabilityCheckError extends Data.TaggedError("CapabilityCheckError")<{
  id: string;
  message: string;
}> {}

export interface CapabilityResult {
  id: string;
  type: CapabilityType;
  status: CapabilityStatus;
  summary: string;
  latencyMs: number;
  lastSuccessfulContact?: string;
  details?: Record<string, unknown>;
}

export interface CapabilityCheck {
  id: string;
  type: CapabilityType;
  healthCheck: Effect.Effect<Omit<CapabilityResult, "latencyMs">, CapabilityCheckError>;
}

export interface CapabilityReport {
  schemaVersion: 1;
  generatedAt: string;
  readiness: number;
  readinessScore: number;
  healthy: number;
  degraded: number;
  unavailable: number;
  checks: CapabilityResult[];
}

export interface CapabilityTrend {
  snapshots: CapabilityReport[];
  latest?: CapabilityReport;
}

export interface CapabilityOptions {
  concurrency?: number;
  saveSnapshot?: boolean;
}

export function defaultCapabilityChecks(projectRoot: string): CapabilityCheck[] {
  return [
    {
      id: "mcp-config",
      type: "mcp",
      healthCheck: Effect.promise(async () => checkMcpConfig()),
    },
    {
      id: "failure-ledger-hook",
      type: "hook",
      healthCheck: Effect.promise(async () => checkFailureLedgerHook()),
    },
    {
      id: "credential-provider-env",
      type: "credential",
      healthCheck: Effect.sync(() => checkCredentialProvider()),
    },
    {
      id: "contract-trust",
      type: "contract",
      healthCheck: Effect.promise(async () => checkContractTrust(projectRoot)),
    },
  ];
}

export function runCapabilityAggregator(
  projectRoot: string,
  options: CapabilityOptions = {}
): Effect.Effect<CapabilityReport, never> {
  return Effect.gen(function* () {
    const checks = defaultCapabilityChecks(projectRoot);
    const previous = yield* Effect.promise(() => readCapabilitySnapshots(25)).pipe(
      Effect.catchAll(() => Effect.succeed([]))
    );
    const results = yield* Effect.all(
      checks.map((check) => runOneCapability(check)),
      { concurrency: options.concurrency ?? checks.length }
    );
    const enriched = applyLastSuccessfulContact(results, previous);
    const report = buildCapabilityReport(enriched);
    yield* Effect.promise(() => recordDeliberateCapabilityDegradations(report.checks)).pipe(
      Effect.catchAll(() => Effect.void)
    );
    if (options.saveSnapshot ?? true) {
      yield* Effect.promise(() => writeCapabilitySnapshot(report)).pipe(
        Effect.catchAll(() => Effect.void)
      );
    }
    return report;
  });
}

export async function capabilityReport(
  projectRoot: string,
  options: CapabilityOptions = {}
): Promise<CapabilityReport> {
  return Effect.runPromise(runCapabilityAggregator(projectRoot, options));
}

export async function readCapabilityTrend(limit = 10): Promise<CapabilityTrend> {
  const snapshots = await readCapabilitySnapshots(limit);
  return {
    snapshots,
    latest: snapshots[snapshots.length - 1],
  };
}

export async function readCapabilitySnapshots(limit = 10): Promise<CapabilityReport[]> {
  const dir = capabilitySnapshotsDir();
  if (!existsSync(dir)) return [];
  const glob = new Bun.Glob("*.json");
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: dir, absolute: true, onlyFiles: true })) {
    files.push(file);
  }
  const reports: CapabilityReport[] = [];
  for (const file of files.sort().slice(-limit)) {
    const parsed = safeParse<CapabilityReport | null>(await Bun.file(file).text(), null);
    if (parsed?.schemaVersion === 1 && Array.isArray(parsed.checks)) reports.push(parsed);
  }
  return reports;
}

export async function writeCapabilitySnapshot(report: CapabilityReport): Promise<string> {
  const dir = capabilitySnapshotsDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${report.generatedAt.replace(/[:.]/g, "-")}.json`);
  await Bun.write(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}

function runOneCapability(check: CapabilityCheck): Effect.Effect<CapabilityResult, never> {
  return Effect.gen(function* () {
    const started = performance.now();
    const result = yield* check.healthCheck.pipe(
      Effect.catchAll((error) =>
        Effect.succeed({
          id: check.id,
          type: check.type,
          status: "unavailable" as const,
          summary: error.message,
        })
      )
    );
    return {
      ...result,
      latencyMs: Math.round(performance.now() - started),
    };
  });
}

function buildCapabilityReport(checks: CapabilityResult[]): CapabilityReport {
  const healthy = checks.filter((check) => check.status === "healthy").length;
  const degraded = checks.filter((check) => check.status === "degraded").length;
  const unavailable = checks.filter((check) => check.status === "unavailable").length;
  const readinessScore = checks.length === 0 ? 100 : Math.round((healthy / checks.length) * 100);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    readiness: readinessScore,
    readinessScore,
    healthy,
    degraded,
    unavailable,
    checks,
  };
}

function applyLastSuccessfulContact(
  results: CapabilityResult[],
  previous: CapabilityReport[]
): CapabilityResult[] {
  const lastHealthy = new Map<string, string>();
  for (const snapshot of previous) {
    for (const check of snapshot.checks) {
      if (check.status === "healthy") lastHealthy.set(check.id, snapshot.generatedAt);
    }
  }
  return results.map((result) => ({
    ...result,
    lastSuccessfulContact:
      result.status === "healthy" ? new Date().toISOString() : lastHealthy.get(result.id),
  }));
}

async function checkMcpConfig(): Promise<Omit<CapabilityResult, "latencyMs">> {
  const path = mcpPath();
  if (!existsSync(path)) {
    return {
      id: "mcp-config",
      type: "mcp",
      status: "unavailable",
      summary: "MCP config missing",
      details: { path },
    };
  }
  const parsed = safeParse<Record<string, unknown> | null>(await Bun.file(path).text(), null);
  const servers =
    parsed && typeof parsed === "object"
      ? ((parsed.mcpServers || parsed.servers) as Record<string, unknown> | undefined)
      : undefined;
  const names = servers && typeof servers === "object" ? Object.keys(servers) : [];
  const unifiedShell = names.includes("unified-shell");
  return {
    id: "mcp-config",
    type: "mcp",
    status: unifiedShell ? "healthy" : "degraded",
    summary: unifiedShell
      ? "unified-shell MCP registered"
      : "MCP config present without unified-shell",
    details: { path, servers: names },
  };
}

async function checkFailureLedgerHook(): Promise<Omit<CapabilityResult, "latencyMs">> {
  const configPath = configTomlPath();
  const ledgerPath = failureLedgerPath();
  const hasConfig = existsSync(configPath);
  const configText = hasConfig ? await Bun.file(configPath).text() : "";
  const hasHook =
    configText.includes("PostToolUseFailure") || configText.includes("log-tool-failure");
  try {
    mkdirSync(ledgerPath.slice(0, ledgerPath.lastIndexOf("/")), { recursive: true });
  } catch {
    return {
      id: "failure-ledger-hook",
      type: "hook",
      status: "unavailable",
      summary: "failure ledger directory is not writable",
      details: { ledgerPath },
    };
  }
  return {
    id: "failure-ledger-hook",
    type: "hook",
    status: hasHook ? "healthy" : "degraded",
    summary: hasHook
      ? "PostToolUseFailure ledger hook configured"
      : "ledger writable; hook not configured",
    details: { configPath, ledgerPath },
  };
}

function checkCredentialProvider(): Omit<CapabilityResult, "latencyMs"> {
  const configured = [
    "KIMI_SIGNING_KEY",
    "KIMI_SIGNING_KEY_FILE",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCESS_TOKEN",
  ].filter((key) => !!Bun.env[key]);
  return {
    id: "credential-provider-env",
    type: "credential",
    status: configured.length > 0 ? "healthy" : "degraded",
    summary:
      configured.length > 0
        ? `${configured.length} credential source(s) available`
        : "no optional credential env vars detected",
    details: {
      configuredKeys: configured,
      intentionalDegrade: configured.length === 0,
      degradeReason: "Credential providers are optional in local-only workflows.",
    },
  };
}

async function checkContractTrust(
  projectRoot: string
): Promise<Omit<CapabilityResult, "latencyMs">> {
  const audit = await auditContractTrust(projectRoot);
  if (audit.invalid > 0) {
    return {
      id: "contract-trust",
      type: "contract",
      status: "unavailable",
      summary: `${audit.invalid} invalid signed contract(s)`,
      details: { audit },
    };
  }
  if (audit.unsigned > 0 || audit.unknownKeys > 0) {
    return {
      id: "contract-trust",
      type: "contract",
      status: "degraded",
      summary: `${audit.unsigned} unsigned, ${audit.unknownKeys} unknown-key contract(s)`,
      details: { audit },
    };
  }
  return {
    id: "contract-trust",
    type: "contract",
    status: "healthy",
    summary:
      audit.contracts.length === 0
        ? "no contracts discovered"
        : `${audit.signed} trusted contract(s)`,
    details: { audit },
  };
}

async function recordDeliberateCapabilityDegradations(checks: CapabilityResult[]): Promise<void> {
  const degraded = checks.filter(
    (check) => check.status === "degraded" && isIntentionalDegrade(check.details)
  );
  for (const check of degraded) {
    await recordDeliberateCapabilityDecision(check);
  }
}

async function recordDeliberateCapabilityDecision(check: CapabilityResult): Promise<void> {
  const key = `capability-degrade:${check.id}`;
  const action = `mark capability ${check.id} degraded`;
  const existing = await queryDecisionLedger({ action, limit: 20 });
  if (existing.some((decision) => decision.key === key && decision.outcome.result === "success")) {
    return;
  }
  const degradeReason =
    typeof check.details?.degradeReason === "string" ? check.details.degradeReason : check.summary;
  await recordDecision({
    key,
    actor: "kimi",
    action,
    trigger: check.summary,
    triggerContext: { summary: check.summary, capabilityItem: check.id },
    rationaleContext: {
      kind: "capability-degrade",
      capabilityItem: check.id,
      reason: degradeReason,
      impactSummary: "Capability remains intentionally degraded until the operator opts in.",
    },
    alternativesConsidered: ["configure optional credential provider env vars"],
    outcome: "success",
    metadata: {
      capabilityType: check.type,
      latencyMs: check.latencyMs,
      deliberate: true,
    },
  });
}

function isIntentionalDegrade(details: Record<string, unknown> | undefined): boolean {
  return details?.intentionalDegrade === true || details?.deliberate === true;
}
