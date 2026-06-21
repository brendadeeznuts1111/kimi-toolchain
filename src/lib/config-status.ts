/**
 * Configuration layers audit — one-shot check for discovery, define registry, and parity gates.
 */

import { auditRuntimeCapabilitiesHealth } from "./bun-install-config.ts";
import { checkScaffoldAligned } from "./scaffold-aligned.ts";
import { writeStdoutLine } from "./cli-contract.ts";
import { runGate } from "./gate-runner.ts";
import { renderMarkdownAnsi } from "./bun-markdown.ts";

export const CONFIG_STATUS_SCHEMA_VERSION = 1;

export type ConfigStatusGateState = "pass" | "fail" | "skip";

export interface ConfigStatusGateResult {
  id: string;
  layer: string;
  status: ConfigStatusGateState;
  ms: number;
  message?: string;
}

export interface ConfigStatusReport {
  schemaVersion: typeof CONFIG_STATUS_SCHEMA_VERSION;
  tool: "config-status";
  aligned: boolean;
  gates: ConfigStatusGateResult[];
  fixPlan: string[];
}

export interface AuditConfigLayersOptions {
  withScaffold?: boolean;
}

interface GateDefinition {
  id: string;
  layer: string;
  cmd: string[];
  fix: string;
}

const CORE_GATES: readonly GateDefinition[] = [
  {
    id: "canonical-references",
    layer: "Discovery",
    cmd: ["bun", "run", "scripts/generate-canonical-references.ts", "--check"],
    fix: "bun run references:generate",
  },
  {
    id: "constants-manifest",
    layer: "Define registry",
    cmd: ["bun", "run", "scripts/generate-constants-manifest.ts", "--check"],
    fix: "bun run manifest:generate",
  },
  {
    id: "constant-parity",
    layer: "Cross-repo contract",
    cmd: ["bun", "run", "scripts/lint-constant-parity.ts"],
    fix: "bun run lint:constant-parity",
  },
] as const;

function gateMessage(stdout: string, stderr: string): string | undefined {
  const text = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
  return text || undefined;
}

async function runSubprocessGate(
  projectRoot: string,
  def: GateDefinition
): Promise<ConfigStatusGateResult> {
  const result = await runGate(def.id, [...def.cmd], { cwd: projectRoot });
  const pass = result.exitCode === 0;
  return {
    id: def.id,
    layer: def.layer,
    status: pass ? "pass" : "fail",
    ms: result.ms,
    message: pass ? undefined : gateMessage(result.stdout, result.stderr),
  };
}

async function runBunInstallRuntimeGate(projectRoot: string): Promise<ConfigStatusGateResult> {
  const start = Bun.nanoseconds();
  const report = await auditRuntimeCapabilitiesHealth(projectRoot);
  const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);

  if (!report.applicable) {
    return {
      id: "bun-install-runtime",
      layer: "Runtime policy",
      status: "skip",
      ms,
      message: "not kimi-toolchain — runtime capability inventory gate skipped",
    };
  }

  return {
    id: "bun-install-runtime",
    layer: "Runtime policy",
    status: report.aligned ? "pass" : "fail",
    ms,
    message: report.aligned
      ? undefined
      : report.checks
          .filter((check) => check.status === "error")
          .map((check) => check.message)
          .join("; "),
  };
}

async function runScaffoldGate(projectRoot: string): Promise<ConfigStatusGateResult> {
  const start = Bun.nanoseconds();
  const report = await checkScaffoldAligned(projectRoot);
  const ms = Math.round((Bun.nanoseconds() - start) / 1_000_000);

  if (!report.applicable) {
    return {
      id: "scaffold",
      layer: "App scaffold",
      status: "skip",
      ms,
      message: "no dx.config.toml [kimi] preflight — scaffold gate not applicable",
    };
  }

  const failed = report.checks.filter((check) => check.status !== "ok");
  const pass = failed.length === 0;
  return {
    id: "scaffold",
    layer: "App scaffold",
    status: pass ? "pass" : "fail",
    ms,
    message: pass ? undefined : failed.map((check) => `${check.name}: ${check.message}`).join("; "),
  };
}

function buildFixPlan(gates: ConfigStatusGateResult[]): string[] {
  const fixes: string[] = [];
  for (const gate of gates) {
    if (gate.status !== "fail") continue;
    const def = CORE_GATES.find((entry) => entry.id === gate.id);
    if (def) fixes.push(def.fix);
    if (gate.id === "scaffold")
      fixes.push("align AGENTS.md scaffold markers (see checkScaffoldAligned)");
    if (gate.id === "bun-install-runtime") fixes.push("bun run bun-install:status --json");
  }
  return [...new Set(fixes)];
}

export async function auditConfigLayersStatus(
  projectRoot: string,
  options: AuditConfigLayersOptions = {}
): Promise<ConfigStatusReport> {
  const [subprocessResults, bunInstallRuntime] = await Promise.all([
    Promise.all(CORE_GATES.map((def) => runSubprocessGate(projectRoot, def))),
    runBunInstallRuntimeGate(projectRoot),
  ]);

  const gates = [...subprocessResults, bunInstallRuntime];
  if (options.withScaffold) {
    gates.push(await runScaffoldGate(projectRoot));
  }

  const aligned = gates.every((gate) => gate.status === "pass" || gate.status === "skip");
  return {
    schemaVersion: CONFIG_STATUS_SCHEMA_VERSION,
    tool: "config-status",
    aligned,
    gates,
    fixPlan: buildFixPlan(gates),
  };
}

function statusMarker(status: ConfigStatusGateState): string {
  if (status === "pass") return "✅";
  if (status === "fail") return "❌";
  return "⏭️";
}

export function formatConfigStatusTable(report: ConfigStatusReport): string {
  const rows = report.gates.map(
    (gate) =>
      `| ${gate.id} | ${gate.layer} | ${statusMarker(gate.status)} ${gate.status} | ${gate.ms} |`
  );
  const header = "| Gate | Layer | Status | ms |\n| ---- | ----- | ------ | -- |";
  const summary = report.aligned
    ? "**All configuration layer gates passed.**"
    : `**${report.gates.filter((g) => g.status === "fail").length} gate(s) failed.**`;
  const fix =
    report.fixPlan.length > 0
      ? `\n\nFix: ${report.fixPlan.map((cmd) => `\`${cmd}\``).join(", ")}`
      : "";
  return `## Configuration layers status\n\n${summary}\n\n${header}\n${rows.join("\n")}${fix}\n`;
}

export function isConfigStatusReport(val: unknown): val is ConfigStatusReport {
  if (typeof val !== "object" || val === null) return false;
  const v = val as ConfigStatusReport;
  return (
    v.schemaVersion === CONFIG_STATUS_SCHEMA_VERSION &&
    v.tool === "config-status" &&
    typeof v.aligned === "boolean" &&
    Array.isArray(v.gates) &&
    Array.isArray(v.fixPlan) &&
    v.gates.every(
      (gate) =>
        typeof gate.id === "string" &&
        typeof gate.layer === "string" &&
        (gate.status === "pass" || gate.status === "fail" || gate.status === "skip") &&
        typeof gate.ms === "number"
    )
  );
}

export async function printConfigStatusReport(report: ConfigStatusReport): Promise<void> {
  const table = formatConfigStatusTable(report);
  await writeStdoutLine(renderMarkdownAnsi(table));

  const failures = report.gates.filter((gate) => gate.status === "fail" && gate.message);
  if (failures.length > 0) {
    process.stderr.write("\n");
    for (const gate of failures) {
      process.stderr.write(`── ${gate.id} ──\n${gate.message}\n\n`);
    }
  }
}

export const CONFIG_STATUS_USAGE = `config:status — configuration layers audit

Runs the core configuration layer gates in parallel:
  - canonical-references  (bun run references:generate --check)
  - constants-manifest    (bun run manifest:generate --check)
  - constant-parity       (bun run lint:constant-parity)
  - bun-install-runtime   (runtimeApiDocs + capability inventory in bun-install-config.ts)

Usage:
  bun run config:status
  bun run config:status --json
  bun run config:status --with-scaffold
  bun run config:status --project <path>

Options:
  --help, -h          Show this help
  --json              Emit ConfigStatusReport JSON
  --with-scaffold     Include scaffold alignment gate (off by default)
  --project <path>    Project root (default: repo root)

Future: --watch for continuous monitoring during development.
`;
