/**
 * KIMI_QUIET=1 — suppress successful gate/tool noise; failures stay verbose.
 * Auto-enabled when KIMI_AGENT_SESSION is set (unless KIMI_QUIET=0).
 */

import { isAgentContext } from "./tool-runner.ts";

/** Propagate agent session → quiet unless explicitly disabled. */
export function ensureQuietEnv(): void {
  if (isAgentContext() && Bun.env.KIMI_QUIET !== "0") {
    Bun.env.KIMI_QUIET = "1";
  }
}

/** True when stdout should be captured and success output suppressed. */
export function isQuietMode(): boolean {
  ensureQuietEnv();
  return Bun.env.KIMI_QUIET === "1";
}

/** Hook summary line (one line on success even in quiet mode). */
export function isHookSummaryMode(): boolean {
  return isQuietMode() || isAgentContext();
}

export interface BunTestSummary {
  pass: number;
  fail: number;
  files: number;
  ms: number;
}

/** Parse Bun test runner footer: "X pass, 0 fail" and "Ran N tests across M files". */
export function parseBunTestSummary(output: string): BunTestSummary | null {
  const passFail = output.match(/(\d+)\s+pass(?:,\s*|\s+)(\d+)\s+fail/);
  const ran = output.match(/Ran\s+(\d+)\s+tests?\s+across\s+(\d+)\s+files?/);
  const ms = output.match(/\[(\d+(?:\.\d+)?)(m?s)\]/);
  if (!passFail) return null;

  let durationMs = 0;
  if (ms) {
    const value = Number(ms[1]);
    durationMs = ms[2] === "s" ? Math.round(value * 1000) : Math.round(value);
  }

  return {
    pass: Number(passFail[1]),
    fail: Number(passFail[2]),
    files: ran ? Number(ran[2]) : 0,
    ms: durationMs,
  };
}
