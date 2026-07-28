/**
 * Subagent orchestrator — unified dispatch for agent-delegated work.
 *
 * Uses invokeTool from tool-runner.ts with specialized timeout handling
 * appropriate for subagent workloads (longer default timeout, structured
 * result wrapping, and dedicated error taxonomy).
 */

import { invokeTool, type ToolInvocation } from "./tool-runner.ts";

export interface SubagentConfig {
  toolPath: string;
  args?: string[];
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  maxOutputBytes?: number;
  gracePeriodMs?: number;
  /** Human-readable label for tracing. */
  label?: string;
}

export interface SubagentResult extends ToolInvocation {
  /** True when the subagent completed without error and non-zero exit. */
  ok: boolean;
}

/** Default timeout for subagent work (2 minutes) — longer than the 30s tool default. */
export const SUBAGENT_DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Run a subagent by invoking its tool script with extended timeout defaults.
 *
 * @returns Structured result with `ok` flag for quick success checks.
 */
export async function runSubagent(config: SubagentConfig): Promise<SubagentResult> {
  const invocation = await invokeTool(config.toolPath, config.args ?? [], {
    timeoutMs: config.timeoutMs ?? SUBAGENT_DEFAULT_TIMEOUT_MS,
    env: config.env,
    maxOutputBytes: config.maxOutputBytes,
    gracePeriodMs: config.gracePeriodMs,
  });

  return {
    ...invocation,
    ok: !invocation.isError && invocation.exitCode === 0,
  };
}
