/**
 * doctor-adapters/guardian.ts — Adapter wrapping kimi-guardian.
 */

import type { AdapterOutput, ExternalToolAdapter } from "../health-check.ts";
import { safeParse } from "../utils.ts";

interface GuardianLogEntry {
  schemaVersion?: number;
  tool?: string;
  level?: string;
  message?: string;
  check?: { name: string; status: "ok" | "warn" | "error"; message: string; fixable?: boolean };
}

function parseGuardianJsonl(stdout: string): {
  errors: number;
  warnings: number;
  checks: GuardianLogEntry["check"][];
} {
  const checks: GuardianLogEntry["check"][] = [];
  let errors = 0;
  let warnings = 0;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const entry = safeParse<GuardianLogEntry>(trimmed, {});
    if (entry.check) {
      checks.push(entry.check);
      if (entry.check.status === "error") errors++;
      if (entry.check.status === "warn") warnings++;
    } else if (entry.level === "error") {
      errors++;
    } else if (entry.level === "warn") {
      warnings++;
    }
  }

  return { errors, warnings, checks };
}

export const guardianAdapter: ExternalToolAdapter = {
  name: "guardian",
  command: ["bun", "run", "src/bin/kimi-guardian.ts", "check", "--json"],
  parse(result): AdapterOutput {
    if (result.error) {
      return {
        adapterName: "guardian",
        durationMs: result.durationMs,
        checks: [
          {
            name: "guardian",
            status: "error",
            message: `adapter guardian failed: ${result.error}`,
            fixable: false,
            category: "doctor_adapter_failed",
            autoFix: "kimi-guardian fix",
          },
        ],
      };
    }
    if (result.timedOut) {
      return {
        adapterName: "guardian",
        durationMs: result.durationMs,
        checks: [
          {
            name: "guardian",
            status: "error",
            message: `adapter guardian timed out after ${result.timeoutMs}ms`,
            fixable: false,
            category: "doctor_adapter_timeout",
          },
        ],
      };
    }

    const { errors, warnings } = parseGuardianJsonl(result.stdout);
    if (errors > 0) {
      return {
        adapterName: "guardian",
        durationMs: result.durationMs,
        checks: [
          {
            name: "guardian",
            status: "error",
            message: `${errors} blocker(s), ${warnings} warning(s)`,
            fixable: true,
            category: "doctor_adapter_failed",
            autoFix: "kimi-guardian fix",
          },
        ],
        rawOutput: result.stdout,
      };
    }

    return {
      adapterName: "guardian",
      durationMs: result.durationMs,
      checks: [
        {
          name: "guardian",
          status: "ok",
          message: warnings > 0 ? `no blockers, ${warnings} warning(s)` : "supply chain clean",
          fixable: false,
        },
      ],
      rawOutput: result.stdout,
    };
  },
};
