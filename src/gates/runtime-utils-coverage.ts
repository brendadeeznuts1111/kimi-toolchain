/**
 * Doctor gate — runtime/utils.mdx wrapper coverage + optional live doc probe.
 *
 * CLI: kimi-doctor --gate runtime-utils-coverage [--save-artifact]
 */
import {
  buildRuntimeUtilsCoverageReport,
  RUNTIME_UTILS_DOCS_PROBE_COMMAND,
} from "../lib/bun-runtime-utils-coverage.ts";
import { queryBunDocsFilesystem } from "../lib/bun-docs-mcp.ts";
import type { Gate, GateResult, GateRunOptions, GateStatus } from "./types.ts";

const MIN_COVERAGE_PERCENT = 85;

export interface RuntimeUtilsCoverageGateResult extends GateResult {
  name: "runtime-utils-coverage";
  ok: boolean;
  coveragePercent: number;
  wrapped: number;
  total: number;
  docProbeOk?: boolean;
  docProbeCommand?: string;
  failures: string[];
  checkedAt: string;
}

export async function runtimeUtilsCoverageGate(
  projectRoot = process.cwd()
): Promise<RuntimeUtilsCoverageGateResult> {
  void projectRoot;
  const report = buildRuntimeUtilsCoverageReport();
  const failures: string[] = [];

  if (report.coveragePercent < MIN_COVERAGE_PERCENT) {
    failures.push(
      `coverage ${report.coveragePercent}% below minimum ${MIN_COVERAGE_PERCENT}% (${report.wrapped}/${report.total} wrapped)`
    );
  }

  let docProbeOk: boolean | undefined;
  if (Bun.env.KIMI_SKIP_NETWORK_PROBE !== "1") {
    const probe = await queryBunDocsFilesystem(RUNTIME_UTILS_DOCS_PROBE_COMMAND, 15000);
    docProbeOk = probe.ok;
    if (!probe.ok) {
      failures.push(
        `utils doc probe failed: ${RUNTIME_UTILS_DOCS_PROBE_COMMAND}${probe.error ? ` — ${probe.error}` : ""}`
      );
    }
  }

  const status: GateStatus = failures.length > 0 ? "fail" : "pass";

  return {
    name: "runtime-utils-coverage",
    status,
    ok: status === "pass",
    reason: failures[0],
    coveragePercent: report.coveragePercent,
    wrapped: report.wrapped,
    total: report.total,
    docProbeOk,
    docProbeCommand: RUNTIME_UTILS_DOCS_PROBE_COMMAND,
    failures,
    checkedAt: new Date().toISOString(),
  };
}

export async function runRuntimeUtilsCoverageGate(opts: GateRunOptions = {}): Promise<GateResult> {
  return runtimeUtilsCoverageGate(opts.projectRoot ?? process.cwd());
}

export const runtimeUtilsCoverageGateDefinition: Gate = {
  name: "runtime-utils-coverage",
  description: "runtime/utils.mdx wrapper coverage and live doc probe",
  level: 2,
  parallel: true,
  run: runRuntimeUtilsCoverageGate,
  format: (result) => formatRuntimeUtilsCoverageGate(result as RuntimeUtilsCoverageGateResult),
};

export function formatRuntimeUtilsCoverageGate(result: RuntimeUtilsCoverageGateResult): string[] {
  const lines = [
    `${result.status}: ${result.name}${result.reason ? ` — ${result.reason}` : ""}`,
    `       └─ coverage: ${result.coveragePercent}% (${result.wrapped}/${result.total} wrapped)`,
  ];
  if (result.docProbeCommand) {
    lines.push(
      `       └─ doc probe: ${result.docProbeOk ? "ok" : "fail"} · ${result.docProbeCommand}`
    );
  }
  for (const f of result.failures) lines.push(`       └─ ${f}`);
  return lines;
}
