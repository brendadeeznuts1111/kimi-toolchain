/**
 * doctor-adapters/dashboard-meta.ts — Gate for Herdr dashboard /api/meta discovery contract.
 */

import type { AdapterOutput } from "../doctor-adapter-types.ts";
import type { ExternalToolAdapter } from "../doctor-adapter-types.ts";
import {
  formatDashboardMetaDiscoveryStatusLine,
  resolveRemoteHostsConfigured,
  type DashboardMetaGateResult,
} from "../herdr-dashboard-meta-gate.ts";
import { safeParse } from "../utils.ts";

interface DashboardMetaJsonEnvelope {
  dashboardMeta?: DashboardMetaGateResult;
  summary?: { ok: boolean };
}

function formatDashboardMetaCheckMessage(result: DashboardMetaGateResult): string {
  if (result.ok && result.discovery) {
    const d = result.discovery;
    const remoteSuffix = result.strict
      ? ` · remoteHosts ${d.remoteHosts?.reachable ?? 0}/${resolveRemoteHostsConfigured(d)} reachable`
      : "";
    return `${formatDashboardMetaDiscoveryStatusLine(d)}${remoteSuffix}`;
  }

  const failure = result.failure;
  if (result.discovery && failure?.detail) {
    return `${formatDashboardMetaDiscoveryStatusLine(result.discovery)}\n  ${failure.detail}`;
  }
  return failure?.message ?? "dashboard meta gate failed";
}

export function dashboardMetaChecksFromResult(
  result: DashboardMetaGateResult
): AdapterOutput["checks"] {
  if (result.ok && result.discovery) {
    return [
      {
        name: "dashboard-meta",
        status: "ok",
        message: formatDashboardMetaCheckMessage(result),
        fixable: false,
      },
    ];
  }

  const failure = result.failure;
  const message = formatDashboardMetaCheckMessage(result);
  const unreachable = failure?.code === "unreachable";

  return [
    {
      name: "dashboard-meta",
      status: "error",
      message,
      fixable: unreachable,
      category: failure?.code ?? "dashboard_meta_gate_failed",
      autoFix: unreachable
        ? "herdr-orchestrator dashboard . --webview --persist-profile"
        : "kimi-doctor --dashboard-meta",
    },
  ];
}

export const dashboardMetaAdapter: ExternalToolAdapter = {
  name: "dashboard-meta",
  command: ["bun", "run", "src/bin/kimi-doctor.ts", "--dashboard-meta", "--json"],
  parse(result): AdapterOutput {
    if (result.error || result.timedOut) {
      return {
        adapterName: "dashboard-meta",
        durationMs: result.durationMs,
        checks: [
          {
            name: "dashboard-meta",
            status: "error",
            message: result.timedOut
              ? `adapter dashboard-meta timed out after ${result.timeoutMs}ms`
              : `adapter dashboard-meta failed: ${result.error}`,
            fixable: true,
            category: result.timedOut ? "doctor_adapter_timeout" : "doctor_adapter_failed",
            autoFix: "kimi-doctor --dashboard-meta",
          },
        ],
      };
    }

    const envelope = safeParse<DashboardMetaJsonEnvelope>(result.stdout, {});
    const gate = envelope.dashboardMeta;
    if (!gate) {
      return {
        adapterName: "dashboard-meta",
        durationMs: result.durationMs,
        checks: [
          {
            name: "dashboard-meta",
            status: "error",
            message: "adapter dashboard-meta returned no gate result",
            fixable: false,
            category: "doctor_adapter_failed",
          },
        ],
        rawOutput: result.stdout,
      };
    }

    return {
      adapterName: "dashboard-meta",
      durationMs: result.durationMs,
      checks: dashboardMetaChecksFromResult(gate),
      rawOutput: result.stdout,
    };
  },
};
