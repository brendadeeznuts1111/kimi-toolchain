/**
 * herdr-dashboard/gates/gate-watch.ts — Background effect-gates probe + bus transitions.
 *
 * Mirrors the browser gate-health overlay (`GET /api/doctor/gates`) on the server
 * so `gate:failed` / `gate:cleared` reach the audit trail without client polling.
 */

import { startIntervalLoop, stopDelayedIntervalLoop } from "../../bun-utils.ts";
import type { DashboardEventBus } from "../bus.ts";
import { fetchDashboardGateHealth, type DashboardGateCheckPayload } from "../data/data.ts";

/** Matches `scheduleGateHealthPoll` in templates/herdr-dashboard.js. */
export const DASHBOARD_GATE_HEALTH_POLL_MS = 30_000;

export interface DashboardGateHealthWatchState {
  lastFailed: boolean | null;
  lastFailures: Array<{ name: string; message: string }>;
}

export type DashboardGateHealthEmitted = "gate:failed" | "gate:cleared" | null;

export interface DashboardGateHealthWatchResult {
  failed: boolean;
  transitioned: boolean;
  emitted: DashboardGateHealthEmitted;
}

export interface DashboardGateHealthWatchOptions {
  projectPath: string;
  pollMs?: number;
  check?: (projectPath: string) => Promise<DashboardGateCheckPayload>;
  log?: (line: string) => void;
}

export interface DashboardGateHealthWatchHandle {
  state: DashboardGateHealthWatchState;
  stop: () => void;
}

function defaultLog(line: string): void {
  process.stderr.write(`[dashboard.gate] ${line}\n`);
}

function failuresFingerprint(failures: Array<{ name: string; message: string }>): string {
  return JSON.stringify(failures);
}

/** Pure transition logic — emits on first failure, failure→clear, or failure-set change. */
export function handleDashboardGateHealthCheck(
  payload: DashboardGateCheckPayload,
  state: DashboardGateHealthWatchState
): DashboardGateHealthWatchResult {
  const failed = payload.failed;
  const wasFailed = state.lastFailed;
  let emitted: DashboardGateHealthEmitted = null;
  let transitioned = false;

  if (wasFailed === null) {
    state.lastFailed = failed;
    state.lastFailures = payload.failures;
    if (failed) {
      emitted = "gate:failed";
      transitioned = true;
    }
    return { failed, transitioned, emitted };
  }

  if (!wasFailed && failed) {
    state.lastFailed = true;
    state.lastFailures = payload.failures;
    emitted = "gate:failed";
    transitioned = true;
    return { failed, transitioned, emitted };
  }

  if (wasFailed && !failed) {
    state.lastFailed = false;
    state.lastFailures = [];
    emitted = "gate:cleared";
    transitioned = true;
    return { failed, transitioned, emitted };
  }

  if (wasFailed && failed) {
    const prev = failuresFingerprint(state.lastFailures);
    const next = failuresFingerprint(payload.failures);
    state.lastFailures = payload.failures;
    if (prev !== next) {
      emitted = "gate:failed";
      transitioned = true;
    }
    return { failed, transitioned, emitted };
  }

  state.lastFailed = false;
  state.lastFailures = [];
  return { failed, transitioned, emitted };
}

/** Poll `kimi-doctor --effect-gates` and emit bus transitions for audit + subscribers. */
export function startDashboardGateHealthWatch(
  bus: DashboardEventBus,
  options: DashboardGateHealthWatchOptions
): DashboardGateHealthWatchHandle {
  const pollMs = options.pollMs ?? DASHBOARD_GATE_HEALTH_POLL_MS;
  const check = options.check ?? fetchDashboardGateHealth;
  const log = options.log ?? defaultLog;
  const state: DashboardGateHealthWatchState = { lastFailed: null, lastFailures: [] };

  const runCheck = async (): Promise<void> => {
    const payload = await check(options.projectPath);
    const at = new Date().toISOString();
    const result = handleDashboardGateHealthCheck(payload, state);
    if (result.emitted === "gate:failed") {
      bus.emit("gate:failed", {
        failures: payload.failures,
        count: payload.failures.length,
        at,
      });
      const names = payload.failures.map((row) => row.name).join(", ");
      log(`gate health failed (${payload.failures.length}/${payload.total}): ${names}`);
      return;
    }
    if (result.emitted === "gate:cleared") {
      bus.emit("gate:cleared", { at });
      log("gate health cleared");
    }
  };

  const loop = startIntervalLoop(pollMs, runCheck);

  return {
    state,
    stop: () => stopDelayedIntervalLoop(loop),
  };
}
