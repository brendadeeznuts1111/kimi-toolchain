/**
 * Doctor gate — detect hardcoded credential-like literals in source.
 *
 * CLI: kimi-doctor --gate hardcoded-secrets [--save-artifact]
 */
import { auditHardcodedSecrets } from "../doctor/hardcoded-secret-audit.ts";
import type { Gate, GateResult, GateRunOptions, GateStatus } from "./types.ts";

export interface HardcodedSecretsGateResult extends GateResult {
  name: "hardcoded-secrets";
  scanned: number;
  count: number;
  findings: Array<{
    file: string;
    line: number;
    type: string;
    snippet: string;
  }>;
  checkedAt: string;
}

export async function hardcodedSecretsGate(
  projectRoot = process.cwd()
): Promise<HardcodedSecretsGateResult> {
  const { findings, count, scanned } = await auditHardcodedSecrets(projectRoot, {
    includeScripts: true,
    includeExamples: true,
  });
  const status: GateStatus = count > 0 ? "fail" : "pass";

  return {
    name: "hardcoded-secrets",
    status,
    reason: count > 0 ? `${count} hardcoded credential-like literal(s) found` : undefined,
    scanned,
    count,
    findings: findings.map((f) => ({
      file: f.file,
      line: f.line,
      type: f.type,
      snippet: f.snippet.slice(0, 200),
    })),
    checkedAt: new Date().toISOString(),
  };
}

/** Registry-facing runner with optional artifact persistence. */
export async function runHardcodedSecretsGate(opts: GateRunOptions = {}): Promise<GateResult> {
  const projectRoot = opts.projectRoot ?? process.cwd();
  return hardcodedSecretsGate(projectRoot);
}

export const hardcodedSecretsGateDefinition: Gate = {
  name: "hardcoded-secrets",
  description: "Detect hardcoded credential-like literals in source",
  level: 2,
  parallel: true,
  run: runHardcodedSecretsGate,
  format: (result) => formatHardcodedSecretsGate(result as HardcodedSecretsGateResult),
};

export function formatHardcodedSecretsGate(result: HardcodedSecretsGateResult): string[] {
  const lines = [
    `${result.status}: ${result.name}${result.reason ? ` — ${result.reason}` : ""}`,
    `       └─ files scanned: ${result.scanned}`,
    `       └─ findings: ${result.count}`,
  ];
  for (const f of result.findings.slice(0, 5)) {
    lines.push(`       └─ ${f.file}:${f.line} [${f.type}] ${f.snippet.slice(0, 60)}`);
  }
  if (result.findings.length > 5) {
    lines.push(`       └─ … and ${result.findings.length - 5} more`);
  }
  return lines;
}
