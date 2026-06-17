import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Effect } from "effect";
import { sshExec } from "./herdr-orchestrator.ts";
import { normalizeRemoteHostConfig } from "./herdr-orchestrator-config.ts";
import type {
  ResolvedRemoteHost,
  RemoteHostConfig,
  RemoteDefaults,
} from "./herdr-orchestrator-config.ts";

// ── Types ────────────────────────────────────────────────────────────────

export type HostStatus = "alive" | "degraded" | "dead";

export interface HostState {
  label: string;
  status: HostStatus;
  since: string; // ISO timestamp of last status change
  lastChecked: string;
  failureCount: number;
  agentCountAtDeath?: number;
}

export interface RecoveryResult {
  host: string;
  previousStatus: HostStatus;
  newStatus: HostStatus;
  revived: boolean;
  error?: string;
}

// ── State ────────────────────────────────────────────────────────────────

const STATE_DIR = join(homedir(), ".herdr", "orchestrator");
const STATE_PATH = join(STATE_DIR, "host-state.json");

function loadState(): Record<string, HostState> {
  if (!existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state: Record<string, HostState>) {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmpPath = STATE_PATH + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmpPath, STATE_PATH);
}

// ── Health check ─────────────────────────────────────────────────────────

export function checkHostHealth(
  hostLabel: string,
  resolved: ResolvedRemoteHost,
  threshold = 3
): {
  status: HostStatus;
  state: HostState;
} {
  const state = loadState();
  const existing = state[hostLabel] || {
    label: hostLabel,
    status: "alive" as HostStatus,
    since: new Date().toISOString(),
    lastChecked: new Date().toISOString(),
    failureCount: 0,
  };

  const result = sshExec(resolved, ["herdr", "version"]);
  existing.lastChecked = new Date().toISOString();

  if (result.ok) {
    if (existing.status === "dead" || existing.status === "degraded") {
      existing.status = "alive";
      existing.since = new Date().toISOString();
      existing.failureCount = 0;
    }
  } else {
    existing.failureCount++;

    if (existing.failureCount >= threshold && existing.status === "alive") {
      existing.status = "degraded";
      existing.since = new Date().toISOString();
    } else if (existing.failureCount >= threshold * 2 && existing.status === "degraded") {
      existing.status = "dead";
      existing.since = new Date().toISOString();
    }
  }

  state[hostLabel] = existing;
  saveState(state);

  return { status: existing.status, state: existing };
}

export function getHostState(hostLabel: string): HostState | null {
  const state = loadState();
  return state[hostLabel] || null;
}

export function getAllHostStates(): Record<string, HostState> {
  return loadState();
}

export function clearHostState(hostLabel: string) {
  const state = loadState();
  delete state[hostLabel];
  saveState(state);
}

// ── Recovery effect ──────────────────────────────────────────────────────

export function recoveryEffect(
  hosts: Record<string, string | RemoteHostConfig>,
  defaults?: RemoteDefaults
): Effect.Effect<RecoveryResult[], never> {
  const resolved = normalizeRemoteHostConfig(hosts, defaults);

  return Effect.gen(function* (_) {
    const results: RecoveryResult[] = [];

    for (const [label, host] of Object.entries(resolved)) {
      const prevState = getHostState(label);
      const prevStatus = prevState?.status || "alive";

      const health = checkHostHealth(label, host);

      if (prevStatus === "dead" && health.status === "alive") {
        results.push({
          host: label,
          previousStatus: "dead",
          newStatus: "alive",
          revived: true,
        });
        yield* _(
          Effect.log(`🟢 host-recovery: ${label} revived (was dead since ${prevState?.since})`)
        );
      } else if (prevStatus === "degraded" && health.status === "alive") {
        results.push({
          host: label,
          previousStatus: "degraded",
          newStatus: "alive",
          revived: true,
        });
        yield* _(Effect.log(`🟡 host-recovery: ${label} recovered from degraded`));
      } else if (prevStatus === "alive" && health.status === "dead") {
        results.push({
          host: label,
          previousStatus: "alive",
          newStatus: "dead",
          revived: false,
          error: `${label} unreachable after ${health.state.failureCount} attempts`,
        });
        yield* _(Effect.logWarning(`🔴 host-recovery: ${label} marked DEAD`));
      }
    }

    return results;
  });
}
