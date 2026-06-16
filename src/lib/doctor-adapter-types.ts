/**
 * doctor-adapter-types.ts — Canonical types-only module for external-tool adapters.
 *
 * This module contains only type definitions so it can be imported by both the
 * adapter registry and individual adapter implementations without introducing
 * runtime import cycles.
 */

import type { HealthCheck } from "./health-check.ts";
import type { ToolInvocation } from "./tool-runner.ts";

/** Structured output returned by every external-tool adapter. */
export interface AdapterOutput {
  /** Unique adapter name used on the CLI with `--adapter <name>`. */
  adapterName: string;
  /** Wall-clock duration of the underlying invocation in milliseconds. */
  durationMs: number;
  /** Health checks derived from the tool output. */
  checks: HealthCheck[];
  /** Optional raw tool output retained for debugging. */
  rawOutput?: string;
}

export interface ExternalToolAdapter {
  /** Unique adapter name used on the CLI with `--adapter <name>`. */
  name: string;
  /** Command and arguments to execute. */
  command: string[];
  /** Convert a completed invocation into a structured adapter output. */
  parse(result: ToolInvocation): AdapterOutput;
}
