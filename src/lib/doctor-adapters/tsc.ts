/**
 * doctor-adapters/tsc.ts — Adapter for `tsc --noEmit` output.
 */

import type { AdapterOutput, ExternalToolAdapter } from "../doctor-adapter-types.ts";

function buildOutput(
  result: { durationMs: number },
  checks: AdapterOutput["checks"]
): AdapterOutput {
  return {
    adapterName: "typecheck",
    durationMs: result.durationMs,
    checks,
  };
}

export const tscAdapter: ExternalToolAdapter = {
  name: "typecheck",
  command: ["tsc", "--noEmit"],
  parse(result): AdapterOutput {
    if (result.error) {
      return buildOutput(result, [
        {
          name: "typecheck",
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
          name: "typecheck",
          status: "error",
          message: `adapter typecheck timed out after ${result.timeoutMs}ms`,
          fixable: false,
          category: "doctor_adapter_timeout",
        },
      ]);
    }
    if (result.exitCode === 0) {
      return buildOutput(result, [
        { name: "typecheck", status: "ok", message: "no type errors", fixable: false },
      ]);
    }
    const detail =
      (result.stdout || result.stderr).trim().split("\n")[0]?.slice(0, 200) ||
      `exit ${result.exitCode}`;
    return buildOutput(result, [
      {
        name: "typecheck",
        status: "error",
        message: detail,
        fixable: false,
        category: "typescript",
        autoFix: "bun run typecheck",
      },
    ]);
  },
};
