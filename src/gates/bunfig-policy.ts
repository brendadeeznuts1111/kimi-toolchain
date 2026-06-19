import {
  auditBunInstallConfig,
  type BunInstallConfigAudit,
  type BunInstallPolicyRow,
} from "../lib/bun-install-config.ts";

import type { Gate, GateResult, GateRunOptions } from "./types.ts";

export type BunfigPolicyGateStatus = "pass" | "warn" | "fail";

export interface BunfigPolicyGateSummary {
  bunfigPath: string | null;
  frozenLockfile: boolean | null;
  minimumReleaseAge: number | null;
  linker: string | null;
  riskyEnvOverrides: string[];
}

export interface BunfigPolicyGateResult {
  name: "bunfig-policy";
  status: BunfigPolicyGateStatus;
  ok: boolean;
  reason?: string;
  failures: string[];
  warnings: string[];
  summary: BunfigPolicyGateSummary;
  audit: BunInstallConfigAudit;
  checkedAt: string;
}

const HARD_LOCKFILE_KEYS = new Set(["saveTextLockfile", "frozenLockfile", "dryRun"]);
const HARD_LIFECYCLE_KEYS = new Set(["ignoreScripts"]);

function policyRowOk(row: BunInstallPolicyRow | undefined): boolean {
  return row?.status === "ok" || row?.status === "n/a";
}

function policyRowMessage(row: BunInstallPolicyRow): string {
  const property = row.bunfigKey ?? row.key;
  if (row.status === "missing") {
    return `${property} is unset; expected ${row.hardenedDefault}`;
  }
  return `${property} is ${row.current ?? "unset"}; expected ${row.hardenedDefault}`;
}

function policyValueBoolean(row: BunInstallPolicyRow | undefined): boolean | null {
  if (row?.current == null) return null;
  return row.current === "true";
}

function policyValueNumber(row: BunInstallPolicyRow | undefined): number | null {
  if (row?.current == null) return null;
  const value = Number(row.current);
  return Number.isFinite(value) ? value : null;
}

function unique(lines: string[]): string[] {
  return [...new Set(lines)];
}

export async function bunfigPolicyGate(
  projectRoot = process.cwd()
): Promise<BunfigPolicyGateResult> {
  const audit = await auditBunInstallConfig(projectRoot);
  const failures: string[] = [];
  const warnings: string[] = [];
  const frozen = audit.tables.lockfile.find((row) => row.key === "frozenLockfile");
  const minimumReleaseAge = audit.tables["supply-chain"].find(
    (row) => row.key === "minimumReleaseAge"
  );
  const linker = audit.tables.linker.find((row) => row.key === "linker");
  const riskyEnvOverrides = audit.envOverrides
    .filter((override) => override.risky)
    .map((override) => override.name);

  if (!audit.bunfigPath || !audit.bunfigInstall) {
    failures.push("missing bunfig.toml [install] policy");
  }

  for (const row of audit.tables.lockfile) {
    if (HARD_LOCKFILE_KEYS.has(row.key) && !policyRowOk(row)) {
      failures.push(policyRowMessage(row));
    }
  }

  for (const row of audit.tables.lifecycle) {
    if (HARD_LIFECYCLE_KEYS.has(row.key) && !policyRowOk(row)) {
      failures.push(policyRowMessage(row));
    }
  }

  for (const name of riskyEnvOverrides) {
    failures.push(`${name} is set; remove the override for reproducible installs`);
  }

  if (minimumReleaseAge && !policyRowOk(minimumReleaseAge)) {
    warnings.push(policyRowMessage(minimumReleaseAge));
  }

  if (linker && !policyRowOk(linker)) {
    warnings.push(policyRowMessage(linker));
  }

  for (const warning of audit.warnings) {
    warnings.push(warning);
  }

  const cleanFailures = unique(failures);
  const cleanWarnings = unique(warnings).filter((warning) => {
    return !cleanFailures.some((failure) => {
      const property = failure.split(" ")[0] ?? failure;
      return warning.includes(property);
    });
  });
  const status: BunfigPolicyGateStatus =
    cleanFailures.length > 0 ? "fail" : cleanWarnings.length > 0 ? "warn" : "pass";

  return {
    name: "bunfig-policy",
    status,
    ok: status === "pass",
    reason:
      status === "pass"
        ? undefined
        : (cleanFailures[0] ?? cleanWarnings[0] ?? "bunfig install policy drift"),
    failures: cleanFailures,
    warnings: cleanWarnings,
    summary: {
      bunfigPath: audit.bunfigPath,
      frozenLockfile: policyValueBoolean(frozen),
      minimumReleaseAge: policyValueNumber(minimumReleaseAge),
      linker: linker?.current ?? null,
      riskyEnvOverrides,
    },
    audit,
    checkedAt: new Date().toISOString(),
  };
}

/** Registry-facing runner with optional artifact persistence. */
export async function runBunfigPolicyGate(opts: GateRunOptions = {}): Promise<GateResult> {
  const projectRoot = opts.projectRoot ?? process.cwd();
  return bunfigPolicyGate(projectRoot);
}

export const bunfigPolicyGateDefinition: Gate = {
  name: "bunfig-policy",
  description: "Audit bunfig.toml install policy",
  level: 3,
  parallel: true,
  run: runBunfigPolicyGate,
  format: (result) => formatBunfigPolicyGate(result as BunfigPolicyGateResult),
};

export function formatBunfigPolicyGate(result: BunfigPolicyGateResult): string[] {
  const lines = [
    `${result.status}: ${result.name}${result.reason ? ` — ${result.reason}` : ""}`,
    `       └─ source: ${result.summary.bunfigPath ?? "bunfig.toml missing"}`,
    `       └─ frozenLockfile: ${result.summary.frozenLockfile ?? "unset"}`,
    `       └─ minimumReleaseAge: ${result.summary.minimumReleaseAge ?? "unset"}`,
    `       └─ linker: ${result.summary.linker ?? "unset"}`,
  ];

  for (const name of result.summary.riskyEnvOverrides) {
    lines.push(`       └─ env override: ${name}`);
  }

  return lines;
}
