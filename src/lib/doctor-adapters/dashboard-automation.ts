/**
 * doctor-adapters/dashboard-automation.ts — Gate for Herdr dashboard WebView smoke + /api/thumbnail.
 */

import type { AdapterOutput, ExternalToolAdapter } from "../doctor-adapter-types.ts";
import {
  dashboardAutomationChecksFromResult,
  type DashboardAutomationJsonEnvelope,
} from "../herdr-dashboard-automation-gate.ts";
import { safeParse } from "../utils.ts";

export const dashboardAutomationAdapter: ExternalToolAdapter = {
  name: "dashboard-automation",
  command: ["bun", "run", "src/bin/kimi-doctor.ts", "--automation", "--json"],
  parse(result): AdapterOutput {
    if (result.error || result.timedOut) {
      return {
        adapterName: "dashboard-automation",
        durationMs: result.durationMs,
        checks: [
          {
            name: "dashboard-automation",
            status: "error",
            message: result.timedOut
              ? `adapter dashboard-automation timed out after ${result.timeoutMs}ms`
              : `adapter dashboard-automation failed: ${result.error}`,
            fixable: true,
            category: result.timedOut ? "doctor_adapter_timeout" : "doctor_adapter_failed",
            autoFix: "kimi-doctor --automation",
          },
        ],
      };
    }

    const envelope = safeParse<DashboardAutomationJsonEnvelope>(result.stdout, {});
    const gate = envelope.dashboardAutomation;
    if (!gate) {
      return {
        adapterName: "dashboard-automation",
        durationMs: result.durationMs,
        checks: [
          {
            name: "dashboard-automation",
            status: "error",
            message: "adapter dashboard-automation returned no gate result",
            fixable: false,
            category: "doctor_adapter_failed",
          },
        ],
        rawOutput: result.stdout,
      };
    }

    return {
      adapterName: "dashboard-automation",
      durationMs: result.durationMs,
      checks: dashboardAutomationChecksFromResult(gate),
      rawOutput: result.stdout,
    };
  },
};
