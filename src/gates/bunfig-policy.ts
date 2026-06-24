import {
  auditBunInstallConfig,
  type BunInstallConfigAudit,
  type BunInstallPolicyRow,
} from "../lib/bun-install-config.ts";
import {
  auditProjectBunfigRedundancy,
  type BunfigRedundancyAudit,
} from "../lib/bunfig-redundancy.ts";
import {
  auditMachineBunPolicy,
  machineCheckFailures,
  machineCheckWarnings,
  type MachineBunPolicyAudit,
} from "../lib/machine-bun-policy.ts";
import {
  buildSsotSummary,
  formatSsotDisplayValue,
  inheritedSsotNotes,
  overrideSsotWarnings,
  readMachineInstallSsot,
  ssotEntry,
  ssotSatisfiesInstallPolicy,
  suppressInheritedSsotWarning,
  unsetSsotWarnings,
  type MachineSsotEntry,
  type MachineSsotKey,
  type MachineSsotSummary,
} from "../lib/machine-bun-ssot.ts";

import type { Gate, GateResult, GateRunOptions } from "./types.ts";

export type BunfigPolicyGateStatus = "pass" | "warn" | "fail";

export interface BunfigPolicyGateSummary {
  bunfigPath: string | null;
  machineBunfigPath: string | null;
  frozenLockfile: boolean | null;
  minimumReleaseAge: number | null;
  linker: string | null;
  globalStore: string | null;
  cacheDir: string | null;
  ssot: MachineSsotSummary;
  riskyEnvOverrides: string[];
  runtimeBun: string;
  packageManager: string | null;
  enginesBun: string | null;
  runtimeSatisfiesEngines: boolean;
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
  machine: MachineBunPolicyAudit;
  /** Install keys inherited from ~/.bunfig.toml when unset in project bunfig. */
  inherited: string[];
  ssot: MachineSsotEntry[];
  redundancy: BunfigRedundancyAudit;
  checkedAt: string;
}

const HARD_LOCKFILE_KEYS = new Set(["saveTextLockfile", "frozenLockfile", "dryRun"]);
const HARD_LIFECYCLE_KEYS = new Set(["ignoreScripts"]);
const HARD_PACKAGE_JSON_KEYS = new Set(["packageManager", "engines.bun"]);

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
  const ssot = await readMachineInstallSsot(audit.bunfigInstall);
  const inherited = inheritedSsotNotes(ssot);
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

  for (const row of audit.tables["package-json"]) {
    if (HARD_PACKAGE_JSON_KEYS.has(row.key) && !policyRowOk(row)) {
      failures.push(policyRowMessage(row));
    }
  }

  if (!audit.versions.runtimeSatisfiesEngines) {
    failures.push(
      `runtime Bun ${audit.versions.runtimeBun} does not satisfy engines.bun ${audit.versions.enginesBun ?? ">=policy"}`
    );
  }

  for (const name of riskyEnvOverrides) {
    failures.push(`${name} is set; remove the override for reproducible installs`);
  }

  if (minimumReleaseAge && !policyRowOk(minimumReleaseAge)) {
    warnings.push(policyRowMessage(minimumReleaseAge));
  }

  for (const row of audit.tables.linker) {
    if (!policyRowOk(row) && !ssotSatisfiesInstallPolicy(ssot, row.key as MachineSsotKey)) {
      warnings.push(policyRowMessage(row));
    }
  }
  for (const row of audit.tables.cache) {
    if (
      row.key === "cacheDir" &&
      !policyRowOk(row) &&
      !ssotSatisfiesInstallPolicy(ssot, "cacheDir")
    ) {
      warnings.push(policyRowMessage(row));
    }
  }

  for (const warning of audit.warnings) {
    if (suppressInheritedSsotWarning(warning, ssot)) continue;
    warnings.push(warning);
  }

  for (const line of overrideSsotWarnings(ssot)) {
    warnings.push(line);
  }
  for (const line of unsetSsotWarnings(ssot)) {
    warnings.push(line);
  }

  const redundancy = await auditProjectBunfigRedundancy(projectRoot);
  const machineBunfigPath = redundancy.machineBunfigPath;
  for (const hit of redundancy.hits) {
    for (const message of hit.messages) {
      warnings.push(`${hit.relativePath}: ${message}`);
    }
  }

  const machine = await auditMachineBunPolicy();
  if (machine.applicable) {
    for (const line of machineCheckFailures(machine.checks)) {
      failures.push(`machine.${line}`);
    }
    for (const line of machineCheckWarnings(machine.checks)) {
      warnings.push(`machine.${line}`);
    }
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
      machineBunfigPath,
      frozenLockfile: policyValueBoolean(frozen),
      minimumReleaseAge: policyValueNumber(minimumReleaseAge),
      linker: linker?.current ?? ssotEntry(ssot, "linker")?.effective ?? null,
      globalStore: ssotEntry(ssot, "globalStore")?.effective ?? null,
      cacheDir: ssotEntry(ssot, "cacheDir")?.effective ?? null,
      ssot: buildSsotSummary(ssot),
      riskyEnvOverrides,
      runtimeBun: audit.versions.runtimeBun,
      packageManager: audit.versions.packageManager,
      enginesBun: audit.versions.enginesBun,
      runtimeSatisfiesEngines: audit.versions.runtimeSatisfiesEngines,
    },
    audit,
    machine,
    inherited,
    ssot,
    redundancy,
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
    `       └─ machine: ${result.summary.machineBunfigPath ?? "n/a (no ~/.bunfig.toml)"}`,
    `       └─ frozenLockfile: ${result.summary.frozenLockfile ?? "unset"}`,
    `       └─ minimumReleaseAge: ${result.summary.minimumReleaseAge ?? "unset"}`,
    `       └─ linker: ${formatSsotDisplayValue(ssotEntry(result.ssot, "linker"))}`,
    `       └─ globalStore: ${formatSsotDisplayValue(ssotEntry(result.ssot, "globalStore"))}`,
    `       └─ cache.dir: ${formatSsotDisplayValue(ssotEntry(result.ssot, "cacheDir"))}`,
    `       └─ runtime: ${result.summary.runtimeBun} | engines.bun=${result.summary.enginesBun ?? "unset"} | ok=${result.summary.runtimeSatisfiesEngines}`,
    `       └─ packageManager: ${result.summary.packageManager ?? "unset"}`,
  ];

  for (const name of result.summary.riskyEnvOverrides) {
    lines.push(`       └─ env override: ${name}`);
  }

  for (const note of result.inherited) {
    lines.push(`       └─ inherit: ${note}`);
  }

  if (result.redundancy.hits.length > 0) {
    for (const hit of result.redundancy.hits) {
      for (const message of hit.messages) {
        lines.push(`       └─ redundant: ${hit.relativePath}: ${message}`);
      }
    }
  }

  if (result.machine.applicable) {
    for (const check of result.machine.checks) {
      const tag = check.ok ? "ok" : "drift";
      lines.push(`       └─ machine.${check.id}: ${tag} — ${check.detail}`);
    }
  }

  return lines;
}
