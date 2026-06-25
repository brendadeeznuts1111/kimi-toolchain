/**
 * doctor-adapters/oxlint.ts — Adapter for oxlint JSON output.
 */

import type { AdapterOutput, ExternalToolAdapter } from "../health-check.ts";
import type { HealthCheck } from "../health-check.ts";
import { safeParse } from "../utils.ts";

interface OxlintDiagnostic {
  message?: string;
  rule_id?: string;
  severity?: string;
  labels?: Array<{ span?: { start?: number; end?: number }; message?: string }>;
}

interface OxlintJson {
  diagnostics?: OxlintDiagnostic[];
  number_of_files?: number;
  number_of_rules?: number;
}

function buildCheck(diagnostic: OxlintDiagnostic): HealthCheck {
  const rule = diagnostic.rule_id ?? "oxlint";
  const message = diagnostic.message ?? "lint issue";
  const location =
    diagnostic.labels && diagnostic.labels.length > 0
      ? ` at ${diagnostic.labels[0].message ?? ""}`
      : "";
  return {
    name: `oxlint:${rule}`,
    status: "error",
    message: `${message}${location}`,
    fixable: false,
    category: "oxlint",
    autoFix: `bun run lint`,
  };
}

function buildOutput(result: { durationMs: number }, checks: HealthCheck[]): AdapterOutput {
  return {
    adapterName: "oxlint",
    durationMs: result.durationMs,
    checks,
  };
}

export const oxlintAdapter: ExternalToolAdapter = {
  name: "oxlint",
  command: ["oxlint", "--format=json", "-c", ".oxlintrc.json", "src", "test", "scripts"],
  parse(result) {
    if (result.error) {
      return buildOutput(result, [
        {
          name: "oxlint",
          status: "error",
          message: `spawn failed: ${result.error}`,
          fixable: false,
          category: "doctor_adapter_failed",
        },
      ]);
    }
    if (result.timedOut) {
      return buildOutput(result, [
        {
          name: "oxlint",
          status: "error",
          message: `adapter oxlint timed out after ${result.timeoutMs}ms`,
          fixable: false,
          category: "doctor_adapter_timeout",
        },
      ]);
    }
    const parsed = safeParse<OxlintJson>(result.stdout, { diagnostics: [] });
    const diagnostics = parsed.diagnostics ?? [];
    if (diagnostics.length === 0 && result.exitCode === 0) {
      return buildOutput(result, [
        { name: "oxlint", status: "ok", message: "no lint issues", fixable: false },
      ]);
    }
    const checks = diagnostics.map(buildCheck);
    if (checks.length === 0 && result.exitCode !== 0) {
      return buildOutput(result, [
        {
          name: "oxlint",
          status: "error",
          message: result.stderr.trim().slice(0, 200) || `exit ${result.exitCode}`,
          fixable: false,
          category: "doctor_adapter_failed",
          autoFix: "bun run lint",
        },
      ]);
    }
    return buildOutput(result, checks);
  },
};
