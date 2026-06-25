/**
 * doctor-adapters/governance.ts — Adapter wrapping kimi-governance score.
 */

import type { AdapterOutput, ExternalToolAdapter } from "../health-check.ts";
import { safeParse } from "../utils.ts";

interface GovernanceScoreJson {
  mode?: string;
  score?: {
    grade?: string;
    total?: number;
    max?: number;
  };
  summary?: {
    ok?: boolean;
    grade?: string;
  };
}

export const governanceAdapter: ExternalToolAdapter = {
  name: "governance",
  command: ["bun", "run", "src/bin/kimi-governance.ts", "score", "--json"],
  parse(result): AdapterOutput {
    if (result.error) {
      return {
        adapterName: "governance",
        durationMs: result.durationMs,
        checks: [
          {
            name: "governance",
            status: "error",
            message: `adapter governance failed: ${result.error}`,
            fixable: false,
            category: "doctor_adapter_failed",
            autoFix: "kimi-governance score",
          },
        ],
      };
    }
    if (result.timedOut) {
      return {
        adapterName: "governance",
        durationMs: result.durationMs,
        checks: [
          {
            name: "governance",
            status: "error",
            message: `adapter governance timed out after ${result.timeoutMs}ms`,
            fixable: false,
            category: "doctor_adapter_timeout",
          },
        ],
      };
    }

    const parsed = safeParse<GovernanceScoreJson>(result.stdout, {});
    const grade = parsed.score?.grade ?? parsed.summary?.grade;
    const total = parsed.score?.total;
    const max = parsed.score?.max;
    const ok = parsed.summary?.ok ?? !(grade === "F" || grade === "D");

    if (!ok) {
      return {
        adapterName: "governance",
        durationMs: result.durationMs,
        checks: [
          {
            name: "governance",
            status: "error",
            message: `R-Score grade ${grade ?? "unknown"}${total !== undefined && max !== undefined ? ` (${total}/${max})` : ""}`,
            fixable: true,
            category: "doctor_adapter_failed",
            autoFix: "kimi-governance score",
          },
        ],
        rawOutput: result.stdout,
      };
    }

    return {
      adapterName: "governance",
      durationMs: result.durationMs,
      checks: [
        {
          name: "governance",
          status: "ok",
          message: `R-Score grade ${grade ?? "unknown"}${total !== undefined && max !== undefined ? ` (${total}/${max})` : ""}`,
          fixable: false,
        },
      ],
      rawOutput: result.stdout,
    };
  },
};
