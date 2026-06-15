/**
 * step-budget.ts — Agent step-budget telemetry and proactive warnings
 *
 * Tracks tool invocations within a turn and warns when approaching limits.
 * Designed to prevent max_steps_exceeded by giving early feedback.
 */

const STEP_WARN_THRESHOLD = 20;
const STEP_CRITICAL_THRESHOLD = 25;

interface StepBudget {
  toolName: string;
  timestamp: number;
  durationMs: number;
  isError: boolean;
}

let _budgetLog: StepBudget[] = [];
let _turnStart = 0;

/** Reset the budget tracker at the start of a new turn. */
export function resetStepBudget(): void {
  _budgetLog = [];
  _turnStart = performance.now();
}

/** Record a tool invocation in the current turn. */
export function recordStep(toolName: string, durationMs: number, isError: boolean): void {
  _budgetLog.push({ toolName, timestamp: performance.now(), durationMs, isError });
}

/** Get current step count and status. */
export function getStepBudgetStatus(): {
  count: number;
  elapsedMs: number;
  status: "ok" | "warn" | "critical";
  message: string;
  recentTools: string[];
} {
  const count = _budgetLog.length;
  const elapsedMs = Math.round(performance.now() - _turnStart);
  const recentTools = _budgetLog.slice(-5).map((s) => s.toolName);

  let status: "ok" | "warn" | "critical" = "ok";
  let message = `${count} steps, ${elapsedMs}ms elapsed`;

  if (count >= STEP_CRITICAL_THRESHOLD) {
    status = "critical";
    message = `CRITICAL: ${count} steps used — risk of max_steps_exceeded. Stop and batch remaining work. Use check:fast instead of full suite.`;
  } else if (count >= STEP_WARN_THRESHOLD) {
    status = "warn";
    message = `WARN: ${count} steps used — approaching limit. Consider batching edits and running targeted tests only.`;
  }

  return { count, elapsedMs, status, message, recentTools };
}

/** Print a step-budget warning if thresholds are crossed. Returns true if critical. */
export function checkStepBudget(): boolean {
  const { status, message } = getStepBudgetStatus();
  if (status === "critical") {
    console.error(`  ✗ ${message}`);
    return true;
  }
  if (status === "warn") {
    console.warn(`  ⚠ ${message}`);
  }
  return false;
}

/** Summarize the turn for telemetry. */
export function summarizeTurn(): {
  totalSteps: number;
  totalDurationMs: number;
  errorCount: number;
  toolBreakdown: Record<string, { count: number; totalMs: number }>;
} {
  const totalSteps = _budgetLog.length;
  const totalDurationMs = _budgetLog.reduce((s, b) => s + b.durationMs, 0);
  const errorCount = _budgetLog.filter((b) => b.isError).length;
  const toolBreakdown: Record<string, { count: number; totalMs: number }> = {};

  for (const b of _budgetLog) {
    const existing = toolBreakdown[b.toolName];
    if (existing) {
      existing.count++;
      existing.totalMs += b.durationMs;
    } else {
      toolBreakdown[b.toolName] = { count: 1, totalMs: b.durationMs };
    }
  }

  return { totalSteps, totalDurationMs, errorCount, toolBreakdown };
}
