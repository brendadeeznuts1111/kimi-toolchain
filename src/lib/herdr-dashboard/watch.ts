/**
 * herdr-dashboard/watch.ts — Event-driven meta gate watch on discovery:refreshed.
 */

import type { DashboardEventBus } from "./bus.ts";
import type { DashboardMetaDiscovery, DashboardRemoteHostsMeta } from "./discovery/meta.ts";
import { validateDashboardMetaDiscovery } from "./gates/meta-gate.ts";

export interface DashboardMetaWatchAdvisory {
  sessionsAvailable: string[];
  remoteHosts: DashboardRemoteHostsMeta["hosts"];
}

export interface DashboardMetaWatchState {
  gateFingerprint: string | null;
  advisory: DashboardMetaWatchAdvisory;
}

export interface DashboardMetaWatchResult {
  gateChanged: boolean;
  gateOk: boolean;
  gateMessage?: string;
  advisoryChanges: string[];
  seeded: boolean;
}

export interface DashboardMetaWatchOptions {
  log?: (line: string) => void;
  onGateFailure?: (message: string) => void;
}

export interface DashboardMetaWatchHandle {
  state: DashboardMetaWatchState;
  stop: () => void;
}

/** Structural contract fingerprint — resolution + candidate count only. */
export function computeDashboardMetaGateFingerprint(
  discovery: Pick<DashboardMetaDiscovery, "workspaceIdResolution" | "workspaceCandidateCount">
): string {
  return `${discovery.workspaceIdResolution}|${discovery.workspaceCandidateCount}`;
}

function defaultLog(line: string): void {
  process.stderr.write(`[dashboard.watch] ${line}\n`);
}

function sessionLabel(session: string): string {
  return session.trim().length > 0 ? session.trim() : "primary";
}

function advisorySnapshot(discovery: DashboardMetaDiscovery): DashboardMetaWatchAdvisory {
  return {
    sessionsAvailable: [...(discovery.sessionsAvailable ?? [])],
    remoteHosts: (discovery.remoteHosts?.hosts ?? []).map((host) => ({
      label: host.label,
      reachable: host.reachable,
      ...(host.version ? { version: host.version } : {}),
      ...(host.error ? { error: host.error } : {}),
    })),
  };
}

/** Emit structured advisory diff when values differ (JSON equality). */
export function logAdvisoryDiff<T>(
  label: string,
  prev: T,
  next: T,
  log: (line: string) => void
): boolean {
  if (JSON.stringify(prev) === JSON.stringify(next)) return false;
  log(`${label} changed: ${JSON.stringify({ from: prev, to: next })}`);
  return true;
}

export function diffSessionsAvailable(prev: string[], next: string[]): string[] {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  const added = next.filter((session) => !prevSet.has(session));
  const removed = prev.filter((session) => !nextSet.has(session));
  if (added.length === 0 && removed.length === 0) return [];
  const parts: string[] = [];
  if (added.length > 0) parts.push(`added [${added.map(sessionLabel).join(", ")}]`);
  if (removed.length > 0) parts.push(`removed [${removed.map(sessionLabel).join(", ")}]`);
  return [`sessionsAvailable: ${parts.join(", ")}`];
}

type RemoteHostSnapshot = DashboardMetaWatchAdvisory["remoteHosts"][number];

function remoteHostKey(host: RemoteHostSnapshot): string {
  return host.label;
}

export function diffRemoteHosts(prev: RemoteHostSnapshot[], next: RemoteHostSnapshot[]): string[] {
  const prevByLabel = new Map(prev.map((host) => [remoteHostKey(host), host]));
  const nextByLabel = new Map(next.map((host) => [remoteHostKey(host), host]));
  const labels = new Set([...prevByLabel.keys(), ...nextByLabel.keys()]);
  const changes: string[] = [];

  for (const label of [...labels].sort()) {
    const before = prevByLabel.get(label);
    const after = nextByLabel.get(label);
    if (!before && after) {
      changes.push(
        `remoteHosts.host "${label}": appeared (reachable ${after.reachable}${after.version ? `, version ${after.version}` : ""})`
      );
      continue;
    }
    if (before && !after) {
      changes.push(`remoteHosts.host "${label}": disappeared`);
      continue;
    }
    if (!before || !after) continue;
    if (before.reachable !== after.reachable) {
      changes.push(
        `remoteHosts.host "${label}": reachable ${before.reachable} → ${after.reachable}`
      );
    }
    if (before.version !== after.version) {
      changes.push(
        `remoteHosts.host "${label}": version ${before.version ?? "—"} → ${after.version ?? "—"}`
      );
    }
    if (before.error !== after.error) {
      changes.push(
        `remoteHosts.host "${label}": error ${before.error ?? "—"} → ${after.error ?? "—"}`
      );
    }
  }

  return changes;
}

function formatAdvisoryChanges(
  before: DashboardMetaWatchAdvisory,
  after: DashboardMetaWatchAdvisory
): string[] {
  return [
    ...diffSessionsAvailable(before.sessionsAvailable, after.sessionsAvailable),
    ...diffRemoteHosts(before.remoteHosts, after.remoteHosts),
  ];
}

/** In-process gate check on cached discovery (no HTTP round-trip). */
export function validateDiscoveryMetaGate(discovery: DashboardMetaDiscovery): {
  ok: boolean;
  message?: string;
} {
  const failure = validateDashboardMetaDiscovery(discovery);
  if (failure) return { ok: false, message: failure.message };
  return { ok: true };
}

/** Handle one discovery refresh — re-gate on structural fingerprint change; advisory log only otherwise. */
export function handleDashboardDiscoveryWatch(
  discovery: DashboardMetaDiscovery,
  state: DashboardMetaWatchState,
  options: DashboardMetaWatchOptions = {}
): DashboardMetaWatchResult {
  const log = options.log ?? defaultLog;
  const fingerprint = computeDashboardMetaGateFingerprint(discovery);
  const isFirst = state.gateFingerprint === null;
  const nextAdvisory = advisorySnapshot(discovery);

  if (isFirst) {
    state.gateFingerprint = fingerprint;
    state.advisory = nextAdvisory;
    return { gateChanged: false, gateOk: true, advisoryChanges: [], seeded: true };
  }

  const gateChanged = fingerprint !== state.gateFingerprint;
  let gateOk = true;
  let gateMessage: string | undefined;

  if (gateChanged) {
    const gate = validateDiscoveryMetaGate(discovery);
    gateOk = gate.ok;
    gateMessage = gate.message;
    if (!gate.ok) {
      const line = `meta gate failed (${fingerprint}): ${gate.message}`;
      log(line);
      options.onGateFailure?.(line);
    } else {
      log(`meta gate ok after structural change (${state.gateFingerprint} → ${fingerprint})`);
    }
    state.gateFingerprint = fingerprint;
  }

  const advisoryChanges = formatAdvisoryChanges(state.advisory, nextAdvisory);
  for (const change of advisoryChanges) {
    log(`advisory: ${change}`);
  }
  state.advisory = nextAdvisory;

  return { gateChanged, gateOk, gateMessage, advisoryChanges, seeded: false };
}

/** Subscribe to discovery:refreshed — shares hub cache state, no separate process. */
export function startDashboardMetaWatch(
  bus: DashboardEventBus,
  options: DashboardMetaWatchOptions = {}
): DashboardMetaWatchHandle {
  const state: DashboardMetaWatchState = {
    gateFingerprint: null,
    advisory: { sessionsAvailable: [], remoteHosts: [] },
  };

  const unsubscribe = bus.on("discovery:refreshed", (event) => {
    handleDashboardDiscoveryWatch(event.discovery, state, options);
  });

  return {
    state,
    stop: unsubscribe,
  };
}
